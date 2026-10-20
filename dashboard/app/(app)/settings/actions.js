'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { randomInt, createHash } from 'node:crypto';
import { tx } from '@/lib/db';
import { checkInterval, checkWindows, intervalKey, minimums } from '@/lib/scheduleRules.mjs';

// Same rules as SETTING_KEYS in the bot (src/db.mjs); the bot ignores anything invalid anyway.
const VALID = {
  excludedCategories: (v) => Array.isArray(v) && v.length <= 500 && v.every((x) => Number.isInteger(x) && x > 0),
  sellableOverrides: (v) => Array.isArray(v) && v.length <= 2000 && v.every((x) => Number.isInteger(x) && x > 0),
  priceJumpLimit: (v) => typeof v === 'number' && v > 0 && v <= 10,
  telegramEnabled: (v) => typeof v === 'boolean',
  baleEnabled: (v) => typeof v === 'boolean',
  ordersDryRun: (v) => typeof v === 'boolean',
  limitedStock: (v) => Number.isInteger(v) && v >= 0 && v <= 1000,
};
const ROLES = ['admin', 'viewer'];

export async function saveSetting(key, value) {
  const user = await requireUser();
  if (!VALID[key]?.(value)) return { error: 'مقدار نامعتبر است' };
  await tx(async (c) => {
    // Old value = saved setting, else what the bot last reported in effect (config.mjs default).
    const { rows } = await c.query(
      `SELECT COALESCE((SELECT value FROM settings WHERE key = $1 FOR UPDATE),
                       (SELECT value -> $1 FROM bot_status WHERE key = 'config')) AS value`, [key]);
    await c.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    await c.query('INSERT INTO settings_audit (actor, action, old_value, new_value) VALUES ($1,$2,$3,$4)',
      [user, key, rows[0].value == null ? null : JSON.stringify(rows[0].value), JSON.stringify(value)]);
  });
  revalidatePath('/settings');
  return { ok: true };
}

export async function requestRun() {
  const user = await requireUser();
  const queued = await tx(async (c) => {
    const { rows } = await c.query('SELECT id FROM run_requests WHERE picked_at IS NULL LIMIT 1');
    if (rows.length) return false; // one pending request is enough
    await c.query('INSERT INTO run_requests (requested_by) VALUES ($1)', [user]);
    await c.query(`INSERT INTO settings_audit (actor, action) VALUES ($1, 'manual_run')`, [user]);
    return true;
  });
  revalidatePath('/settings');
  return queued ? { ok: true } : { error: 'یک درخواست اجرا از قبل در صف است' };
}

/** One-time 6-digit code (valid 30 min) that links a Telegram/Bale chat to the bots. Only its hash is stored. */
export async function createInvite(role) {
  const user = await requireUser();
  if (!ROLES.includes(role)) return { error: 'نقش نامعتبر است' };
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await tx(async (c) => {
    await c.query('INSERT INTO messenger_invites (code_hash, role, created_by, expires_at) VALUES ($1,$2,$3,$4)',
      [createHash('sha256').update(code).digest('hex'), role, user, expiresAt]);
    await c.query(`INSERT INTO settings_audit (actor, action, new_value) VALUES ($1, 'messenger_invite', $2)`, [user, JSON.stringify(role)]);
  });
  return { ok: true, code, expiresAt: expiresAt.toISOString() };
}

export async function setChatRole(id, role) {
  const user = await requireUser();
  if (!ROLES.includes(role)) return { error: 'نقش نامعتبر است' };
  await tx(async (c) => {
    const { rows } = await c.query('UPDATE messenger_chats SET role = $2 WHERE id = $1 RETURNING display_name, platform', [id, role]);
    if (rows[0]) await c.query(`INSERT INTO settings_audit (actor, action, new_value) VALUES ($1, 'messenger_role', $2)`,
      [user, JSON.stringify(`${rows[0].platform}:${rows[0].display_name} → ${role}`)]);
  });
  revalidatePath('/settings');
  return { ok: true };
}

export async function removeChat(id) {
  const user = await requireUser();
  await tx(async (c) => {
    const { rows } = await c.query('DELETE FROM messenger_chats WHERE id = $1 RETURNING display_name, platform', [id]);
    if (rows[0]) await c.query(`INSERT INTO settings_audit (actor, action, old_value) VALUES ($1, 'messenger_remove', $2)`,
      [user, JSON.stringify(`${rows[0].platform}:${rows[0].display_name}`)]);
  });
  revalidatePath('/settings');
  return { ok: true };
}

// Schedule (sync_settings) — the same rules as the bot (lib/scheduleRules.mjs = the bot's src/schedule-rules.mjs):
// minimum intervals from env, windows round the clock with the night kept. The bots' «⏱ زمان‌بندی» edits the same
// rows, so the panel and the bots always show the same schedule. Every change: settings_audit (who, what, before, after).
const TIMES = ['day_start', 'evening_start', 'night_start'];

/** Writes rows + their audit lines in one transaction; `group` = one audit line for all keys (the windows). */
async function writeSchedule(user, changes, group = null) {
  await tx(async (c) => {
    const keys = Object.keys(changes);
    const { rows } = await c.query('SELECT key, value FROM sync_settings WHERE key = ANY ($1) FOR UPDATE', [keys]);
    const old = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    for (const [key, value] of Object.entries(changes)) {
      await c.query(
        `INSERT INTO sync_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
    if (group) {
      const before = keys.some((k) => k in old) ? Object.fromEntries(keys.map((k) => [k, old[k] ?? null])) : null;
      await c.query('INSERT INTO settings_audit (actor, action, old_value, new_value) VALUES ($1,$2,$3,$4)',
        [user, group, before == null ? null : JSON.stringify(before), JSON.stringify(changes)]);
    } else {
      for (const [key, value] of Object.entries(changes)) {
        await c.query('INSERT INTO settings_audit (actor, action, old_value, new_value) VALUES ($1,$2,$3,$4)',
          [user, `schedule:${key}`, key in old ? JSON.stringify(old[key]) : null, JSON.stringify(value)]);
      }
    }
  });
  revalidatePath('/settings');
  revalidatePath('/banners');
}

export async function savePaused(paused) {
  const user = await requireUser();
  if (typeof paused !== 'boolean') return { error: 'مقدار نامعتبر است' };
  await writeSchedule(user, { paused });
  return { ok: true };
}

/** { day_start, evening_start, night_start } together: day → evening → night round the clock, night kept. */
export async function saveWindows(times) {
  const user = await requireUser();
  const next = Object.fromEntries(TIMES.map((k) => [k, typeof times?.[k] === 'string' ? times[k].trim() : times?.[k]]));
  const error = checkWindows(next);
  if (error) return { error };
  await writeSchedule(user, next, 'schedule:windows');
  return { ok: true };
}

/** { day_catalog_minutes: 60, evening_hero_minutes: 30, … } — each at least its task's minimum (env). */
export async function saveIntervals(values) {
  const user = await requireUser();
  const entries = Object.entries(values ?? {});
  if (!entries.length) return { error: 'تغییری نیست' };
  for (const [key, minutes] of entries) {
    const iv = intervalKey(key);
    if (!iv) return { error: 'تنظیم ناشناخته' };
    const error = checkInterval(iv[1], minutes, process.env);
    if (error) return { error };
  }
  await writeSchedule(user, Object.fromEntries(entries));
  return { ok: true };
}

/** The minimums in effect (env), for the form's hints. */
export async function scheduleMinimums() {
  await requireUser();
  return minimums(process.env);
}
