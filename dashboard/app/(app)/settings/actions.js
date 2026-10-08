'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { tx } from '@/lib/db';

// Same rules as SETTING_KEYS in the bot (src/db.mjs); the bot ignores anything invalid anyway.
const VALID = {
  excludedCategories: (v) => Array.isArray(v) && v.length <= 500 && v.every((x) => Number.isInteger(x) && x > 0),
  sellableOverrides: (v) => Array.isArray(v) && v.length <= 2000 && v.every((x) => Number.isInteger(x) && x > 0),
  priceJumpLimit: (v) => typeof v === 'number' && v > 0 && v <= 10,
  intervalHours: (v) => typeof v === 'number' && v >= 0.5 && v <= 168,
};

export async function saveSetting(key, value) {
  const user = await requireUser();
  if (!VALID[key]?.(value)) return { error: 'مقدار نامعتبر است' };
  await tx(async (c) => {
    const { rows } = await c.query('SELECT value FROM settings WHERE key = $1 FOR UPDATE', [key]);
    await c.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    await c.query('INSERT INTO settings_audit (actor, action, old_value, new_value) VALUES ($1,$2,$3,$4)',
      [user, key, rows[0] ? JSON.stringify(rows[0].value) : null, JSON.stringify(value)]);
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
