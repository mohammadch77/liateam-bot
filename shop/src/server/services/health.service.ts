import 'server-only';
import { getConfig } from '@/lib/config';
import { toAppError, type ErrorCode } from '@/lib/errors';
import { healthRepository } from '@/server/repositories/health.repository';
import { siteSettingsRepository } from '@/server/repositories/site-settings.repository';

export type HealthReport = {
  status: 'ok' | 'degraded';
  env: string;
  checks: {
    database: { status: 'up' | 'down'; latencyMs: number; code?: ErrorCode };
    /** the catalog sync: minutes since the last successful run (null = unknown) and whether the schedule is paused */
    sync: { lastOkMinutesAgo: number | null; paused: boolean | null };
  };
  time: string;
};

/** The admin panel's «وضعیت همگام‌سازی» card. */
export type SyncStatus = {
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastOkAt: Date | null;
  products: number;
  events24h: number;
  paused: boolean;
  lastRevalidateAt: Date | null;
};

const LAST_REVALIDATE_KEY = 'sync.last_revalidate';

export const healthService = {
  async check(): Promise<HealthReport> {
    const started = performance.now();
    let database: HealthReport['checks']['database'];
    try {
      await healthRepository.ping();
      database = { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      database = {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        code: toAppError(e).code,
      };
    }
    let sync: HealthReport['checks']['sync'] = { lastOkMinutesAgo: null, paused: null };
    if (database.status === 'up') {
      const row = await healthRepository.syncStatus().catch(() => null);
      if (row)
        sync = {
          lastOkMinutesAgo: row.last_ok_at
            ? Math.round((Date.now() - row.last_ok_at.getTime()) / 60_000)
            : null,
          paused: row.paused,
        };
    }
    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      env: getConfig().APP_ENV,
      checks: { database, sync },
      time: new Date().toISOString(),
    };
  },

  /** For the panel (admins only, checked by the page); null when the status function is not installed. */
  async syncStatus(): Promise<SyncStatus | null> {
    const [row, settings] = await Promise.all([
      healthRepository.syncStatus(),
      siteSettingsRepository.get([LAST_REVALIDATE_KEY]),
    ]);
    if (!row) return null;
    const last = settings.get(LAST_REVALIDATE_KEY);
    return {
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastOkAt: row.last_ok_at,
      products: row.products,
      events24h: row.events_24h,
      paused: row.paused,
      lastRevalidateAt: typeof last === 'string' ? new Date(last) : null,
    };
  },

  /** The bot's last revalidate call (shown in the panel); never fails the call itself. */
  async recordRevalidate(): Promise<void> {
    await siteSettingsRepository.set(LAST_REVALIDATE_KEY, new Date().toISOString(), null).catch(() => {});
  },
};
