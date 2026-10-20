import 'server-only';
import { q } from './db';
import { getStatus } from './data';

const WORKER_STALE_MS = 2 * 60_000;

/**
 * Everything the health cards need, in one place (also used by the runs page header). Freshness follows the window
 * schedule: prices are «old» only when the price task is overdue on its own schedule (asleep at night is not old).
 */
export async function getHealth() {
  const [status, [last], [lastGood]] = await Promise.all([
    getStatus(),
    q('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
    q(`SELECT * FROM sync_runs WHERE status IN ('ok','warning') AND (tasks IS NULL OR 'catalog' = ANY (tasks))
        ORDER BY started_at DESC LIMIT 1`),
  ]);
  const worker = status.worker ?? {};
  const workerAlive = worker.heartbeat && Date.now() - new Date(worker.heartbeat).getTime() < WORKER_STALE_MS;
  const day = worker.schedule?.windows?.find((w) => w.name === (worker.window === 'evening' ? 'evening' : 'day'));
  const intervalMin = day?.minutes?.catalog ?? 60; // base interval of the price task in the current window
  const nextRun = worker.next_run_at?.catalog ?? null;

  const ageMs = lastGood ? Date.now() - new Date(lastGood.started_at).getTime() : null;
  const overdueMs = nextRun ? Date.now() - new Date(nextRun).getTime() : null;
  const freshness = lastGood == null ? 'bad'
    : overdueMs == null ? (ageMs <= intervalMin * 60_000 * 1.25 ? 'ok' : 'warn')
    : overdueMs <= 30 * 60_000 ? 'ok' : overdueMs <= intervalMin * 60_000 * 2 ? 'warn' : 'bad';

  return { status, last, lastGood, intervalMin, window: worker.window ?? null, paused: !!worker.paused, workerAlive, nextRun, ageMs, freshness };
}
