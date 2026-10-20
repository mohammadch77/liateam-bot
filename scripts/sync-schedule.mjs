// Prints the sync schedule: current window, paused or not, each task's last and next run (Tehran time).
//   npm run sync:schedule
//   npm run sync:schedule -- --simulate 24     the runs the next 24 hours would make (from now; random jitter)
//   npm run sync:schedule -- --simulate 24 --from 2026-10-20T00:00   …from a given Tehran time (no database needed)
import { TASKS, clock, resolveSchedule, simulate, windowAt, zoned } from '../src/scheduler.mjs';

const argv = process.argv.slice(2);
const sim = argv.indexOf('--simulate');
const fromArg = argv.indexOf('--from');
const fa = (d) => (d ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' }).format(d) : '—');

async function settings() {
  if (fromArg >= 0) return { cfg: resolveSchedule(process.env).cfg, db: null };
  const { openDb, loadSchedule } = await import('../src/db.mjs');
  const db = await openDb();
  return { cfg: (await loadSchedule(db, resolveSchedule)).cfg, db };
}

const { cfg, db } = await settings();
try {
  const now = fromArg >= 0 ? new Date(`${argv[fromArg + 1]}:00+03:30`) : new Date();
  const w = windowAt(now, cfg);
  console.log(`now ${fa(now)} (Tehran ${clock(now, cfg)}) — window: ${w.name}${w.sleep ? ' (asleep: no request to Liateam)' : ''}${cfg.paused ? ' — PAUSED' : ''}`);
  console.log(`windows: ${cfg.windows.map((x) => `${x.name} ${x.from}–${x.to} ${x.sleep ? 'sleep' : TASKS.map((t) => `${t} ${x.minutes[t] ?? '–'}′`).join(' ')}`).join(' | ')}; jitter ±${Math.round(cfg.jitter * 100)}%`);

  if (db) {
    const { scheduleRows } = await import('../src/db.mjs');
    const rows = await scheduleRows(db);
    const { rows: [bo] } = await db.query(`SELECT value FROM bot_status WHERE key = 'backoff'`);
    if (bo?.value?.until && new Date(bo.value.until) > now) console.log(`backoff until ${fa(new Date(bo.value.until))} (level ${bo.value.level})`);
    for (const t of TASKS) {
      const r = rows[t] ?? {};
      console.log(`  ${t.padEnd(8)} last ${fa(r.last_run_at)} (${r.last_status ?? '—'})  →  next ${fa(r.next_run_at)}`);
    }
  }

  if (sim >= 0) {
    const hours = Number(argv[sim + 1]) || 24;
    const runs = simulate(now, hours, cfg);
    console.log(`\nsimulation: ${hours} h from ${clock(now, cfg)} — ${runs.length} task runs`);
    for (const t of TASKS) {
      const mine = runs.filter((r) => r.task === t);
      console.log(`  ${t.padEnd(8)} ${String(mine.length).padStart(3)}×  ${mine.map((r) => clock(r.at, cfg)).join(' ')}`);
    }
    const night = runs.filter((r) => windowAt(r.at, cfg).sleep);
    const round = runs.filter((r) => zoned(r.at, cfg.timeZone).mi === 0);
    console.log(`  runs at night: ${night.length} · runs on a round hour: ${round.length}`);
  }
} finally {
  await db?.end();
}
