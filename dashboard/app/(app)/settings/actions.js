'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { randomInt, createHash } from 'node:crypto';
import { tx } from '@/lib/db';

// Same rules as SETTING_KEYS in the bot (src/db.mjs); the bot ignores anything invalid anyway.
const VALID = {
  excludedCategories: (v) => Array.isArray(v) && v.length <= 500 && v.every((x) => Number.isInteger(x) && x > 0),
  sellableOverrides: (v) => Array.isArray(v) && v.length <= 2000 && v.every((x) => Number.isInteger(x) && x > 0),
  priceJumpLimit: (v) => typeof v === 'number' && v > 0 && v <= 10,
  intervalHours: (v) => typeof v === 'number' && v >= 0.25 && v <= 168,
  telegramEnabled: (v) => typeof v === 'boolean',
  baleEnabled: (v) => typeof v === 'boolean',
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
