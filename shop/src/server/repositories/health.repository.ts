import 'server-only';
import { query, queryOne } from '@/lib/db';

export type SyncStatusRow = {
  last_sync_at: Date | null;
  last_sync_status: string | null;
  last_ok_at: Date | null;
  products: number;
  events_24h: number;
  paused: boolean;
};

/** Whether deploy/…-013 is installed (until then the sync status is simply unknown). */
let ready: { ok: boolean; at: number } | null = null;
async function hasSyncStatus(): Promise<boolean> {
  if (ready && (ready.ok || Date.now() - ready.at < 5 * 60_000)) return ready.ok;
  const row = await queryOne<{ ok: boolean }>(
    'health.sync_status_ready',
    `SELECT to_regprocedure('public.shop_sync_status()') IS NOT NULL
        AND has_function_privilege('public.shop_sync_status()', 'EXECUTE') AS ok`,
  );
  ready = { ok: !!row?.ok, at: Date.now() };
  return ready.ok;
}

export const healthRepository = {
  /** The sync bot's numbers (public.shop_sync_status, grants 013); null when not installed. */
  async syncStatus(): Promise<SyncStatusRow | null> {
    if (!(await hasSyncStatus())) return null;
    const rows = await query<SyncStatusRow>('health.sync_status', 'SELECT * FROM public.shop_sync_status()');
    return rows[0] ?? null;
  },

  /** Round-trip to Postgres; throws AppError when the database is unreachable. */
  async ping(): Promise<void> {
    await queryOne<{ ok: number }>('health.ping', 'SELECT 1 AS ok');
  },
};
