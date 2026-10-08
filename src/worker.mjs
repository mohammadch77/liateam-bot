// Long-running scheduler for servers (instead of Windows Task Scheduler / cron):
// runs src/sync.mjs every `intervalHours` (settings table, editable in the dashboard) and
// whenever the dashboard queues a manual run in run_requests. One sync at a time.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { openDb, applySettings, setStatus } from './db.mjs';
import { inQuietHours } from './schedule.mjs';

const POLL_MS = 30_000;
// Scheduled runs drift by up to ±10% of the interval so requests to the supplier never land on a fixed clock.
const JITTER = 0.1;
let jitterFactor = 1 + (Math.random() * 2 - 1) * JITTER; // re-drawn after every run
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
    const nextAt = last.at ? new Date(last.at.getTime() + config.intervalHours * 3600_000 * jitterFactor) : new Date();
    await setStatus(db, 'worker', { heartbeat: new Date().toISOString(), interval_hours: config.intervalHours, next_run_at: nextAt.toISOString() });

    // Never two runs closer than minGapMinutes, whoever asks; pending manual requests simply wait.
    const sinceLast = last.at ? Date.now() - last.at.getTime() : Infinity;
    if (sinceLast < config.minGapMinutes * 60_000) return;
    // Claim all pending manual requests at once; several clicks still mean one run.
    const { rowCount: manual } = await db.query('UPDATE run_requests SET picked_at = now() WHERE picked_at IS NULL');
    if (!manual && nextAt > new Date()) return;
    if (!manual && inQuietHours(config.quietHours)) return; // scheduled runs sleep at night
    log.info(`worker: starting sync (${manual ? 'manual request' : 'scheduled'})`);
    await setStatus(db, 'worker', { heartbeat: new Date().toISOString(), interval_hours: config.intervalHours, next_run_at: nextAt.toISOString(), running_since: new Date().toISOString() });
  } finally {
    await db.end();
  }
  const code = await runSync();
  jitterFactor = 1 + (Math.random() * 2 - 1) * JITTER;
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
