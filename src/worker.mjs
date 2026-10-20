// Long-running scheduler for servers: every 30 s it looks at sync_schedule (scheduler.mjs windows: day / evening /
// night) and starts src/sync.mjs with the tasks that are due (catalog, hero, details), one run at a time. Each run
// stores its tasks' next times, so a restart keeps the pattern. Manual runs queued in run_requests (dashboard,
// bots) run every task at once, ignoring the window; nothing runs while the schedule is paused (sync_settings)
// or while backing off after Liateam refused us (backoff.mjs).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { openDb, applySettings, setStatus, loadSchedule, scheduleRows, setNextRun } from './db.mjs';
import { TASKS, dueTasks, resolveSchedule, scheduleSummary, windowAt } from './scheduler.mjs';
import { inBackoff } from './backoff.mjs';

const POLL_MS = 30_000;
const syncScript = fileURLToPath(new URL('./sync.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runSync = (args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [syncScript, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code));
  });

async function tick() {
  const db = await openDb();
  let args = null;
  try {
    await applySettings(db, config);
    const { cfg, ignored } = await loadSchedule(db, resolveSchedule);
    if (ignored.length) log.warn('worker: schedule settings ignored (unknown key or bad value)', { keys: ignored });
    const now = new Date();
    const rows = await scheduleRows(db);

    // one decision from the stored rows and the clock (scheduler.mjs dueTasks): the same after a restart
    const plan = dueTasks(rows, now, cfg);
    for (const [task, at] of Object.entries(plan.init)) {
      await setNextRun(db, task, at);
      rows[task] = { ...rows[task], next_run_at: at };
    }
    for (const [task, at] of Object.entries(plan.defer)) await setNextRun(db, task, at);
    const window = windowAt(now, cfg);
    for (const [task, at] of Object.entries(plan.defer)) rows[task] = { ...rows[task], next_run_at: at };
    const next = Object.fromEntries(TASKS.map((t) => [t, rows[t]?.next_run_at ? new Date(rows[t].next_run_at).toISOString() : null]));
    // the schedule in effect, for the dashboard and the bots (they edit sync_settings; this shows the result)
    const shown = { window: window.name, paused: cfg.paused, next_run_at: next, schedule: scheduleSummary(cfg) };
    await setStatus(db, 'worker', { heartbeat: now.toISOString(), ...shown });

    // backing off (Liateam refused us): nothing runs, manual requests wait in the queue until it ends
    const { rows: [bo] } = await db.query(`SELECT value FROM bot_status WHERE key = 'backoff'`);
    if (inBackoff(bo?.value, now)) {
      await setStatus(db, 'worker', { heartbeat: now.toISOString(), ...shown, backoff_until: bo.value.until });
      return;
    }

    // never two runs closer than minGapMinutes, whoever asks; pending manual requests simply wait
    const { rows: [last] } = await db.query('SELECT max(started_at) AS at FROM sync_runs');
    if (last.at && now - last.at < config.minGapMinutes * 60_000) return;

    // claim all pending manual requests at once; several clicks still mean one run (every task, any window)
    const { rowCount: manual } = await db.query('UPDATE run_requests SET picked_at = now() WHERE picked_at IS NULL');
    if (manual) {
      args = ['--force'];
      log.info('worker: starting sync (manual request, every task)');
    } else {
      const due = plan.due;
      if (!due.length) return;
      args = [`--tasks=${due.join(',')}`];
      log.info(`worker: starting sync (scheduled: ${due.join(', ')}; window ${window.name})`);
    }
    await setStatus(db, 'worker', { heartbeat: now.toISOString(), ...shown, running_since: now.toISOString() });
  } finally {
    await db.end();
  }
  if (!args) return;
  const code = await runSync(args);
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
