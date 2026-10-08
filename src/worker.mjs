// Long-running scheduler for servers (instead of Windows Task Scheduler / cron):
// runs src/sync.mjs every `intervalHours` (settings table, editable in the dashboard) and
// whenever the dashboard queues a manual run in run_requests. One sync at a time.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { openDb, applySettings, setStatus } from './db.mjs';

const POLL_MS = 30_000;
const syncScript = fileURLToPath(new URL('./sync.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runSync = () =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [syncScript], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code));
  });

async function tick() {
  const db = await openDb();
  try {
    await applySettings(db, config);
    const { rows: [last] } = await db.query('SELECT max(started_at) AS at FROM sync_runs');
    const nextAt = last.at ? new Date(last.at.getTime() + config.intervalHours * 3600_000) : new Date();
    await setStatus(db, 'worker', { heartbeat: new Date().toISOString(), interval_hours: config.intervalHours, next_run_at: nextAt.toISOString() });

    // Claim all pending manual requests at once; several clicks still mean one run.
    const { rowCount: manual } = await db.query('UPDATE run_requests SET picked_at = now() WHERE picked_at IS NULL');
    if (!manual && nextAt > new Date()) return;
    log.info(`worker: starting sync (${manual ? 'manual request' : 'scheduled'})`);
    await setStatus(db, 'worker', { heartbeat: new Date().toISOString(), interval_hours: config.intervalHours, next_run_at: nextAt.toISOString(), running_since: new Date().toISOString() });
  } finally {
    await db.end();
  }
  const code = await runSync();
  log.info(`worker: sync exited with ${code}`);
}

log.info('worker started');
for (;;) {
  try {
    await tick();
  } catch (e) {
    log.warn('worker tick failed', { error: e.code ?? e.message });
  }
  await sleep(POLL_MS);
}
