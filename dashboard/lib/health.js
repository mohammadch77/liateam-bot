import 'server-only';
import { q } from './db';
import { getStatus } from './data';

export const DEFAULT_INTERVAL_H = 4; // matches config.mjs when the bot has not reported yet
const WORKER_STALE_MS = 2 * 60_000;

/** Everything the health cards need, in one place (also used by the runs page header). */
export async function getHealth() {
  const [status, [last], [lastGood]] = await Promise.all([
    getStatus(),
    q('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
    q(`SELECT * FROM sync_runs WHERE status IN ('ok','warning') ORDER BY started_at DESC LIMIT 1`),
  ]);
  const intervalH = status.worker?.interval_hours ?? status.config?.intervalHours ?? DEFAULT_INTERVAL_H;
  const workerAlive = status.worker?.heartbeat && Date.now() - new Date(status.worker.heartbeat).getTime() < WORKER_STALE_MS;
  const nextRun = workerAlive
    ? status.worker.next_run_at
    : last ? new Date(new Date(last.started_at).getTime() + intervalH * 3600_000).toISOString() : null;

  const ageMs = lastGood ? Date.now() - new Date(lastGood.started_at).getTime() : null;
  const ratio = ageMs == null ? Infinity : ageMs / (intervalH * 3600_000);
  const freshness = ratio <= 1.25 ? 'ok' : ratio <= 2 ? 'warn' : 'bad';

  return { status, last, lastGood, intervalH, workerAlive, nextRun, ageMs, ratio, freshness };
}
