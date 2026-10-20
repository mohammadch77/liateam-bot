// Window-based schedule (pure functions; the worker and sync.mjs store the result in sync_schedule).
//
//   day      07:00–19:00  prices/stock every ~60 min, banners every ~30 min, heavy content every ~180 min
//   evening  19:00–23:00  prices/stock every ~240 min, banners every ~30 min, heavy content every ~180 min
//   night    23:00–07:00  asleep: no request to Liateam at all
//
// Every interval moves randomly by ±jitter (default 20 %), no run starts on a round hour, and a run that would fall
// into the night (or any window where its task is off) moves to the first allowed moment after it: the window start
// plus a random 1–15 minutes. Times are Asia/Tehran wall-clock (no DST since 2022, but computed, not assumed).
// Settings: env (defaults below) overlaid by the sync_settings table (scheduleSettings in db.mjs).

export const TASKS = ['catalog', 'hero', 'details'];

export const DEFAULT_SCHEDULE = {
  timeZone: 'Asia/Tehran',
  windows: [
    { name: 'day', from: '07:00', to: '19:00', minutes: { catalog: 60, hero: 30, details: 180 } },
    { name: 'evening', from: '19:00', to: '23:00', minutes: { catalog: 240, hero: 30, details: 180 } },
    { name: 'night', from: '23:00', to: '07:00', sleep: true, minutes: {} },
  ],
  jitter: 0.2,
  wakeJitterMinutes: 15,
  paused: false,
};

const MIN = 60_000;
const hhmm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`bad time "${s}" (HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Wall-clock parts of `date` in `timeZone`. */
export function zoned(date, timeZone = DEFAULT_SCHEDULE.timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, minuteOfDay: +p.hour * 60 + +p.minute };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (Tehran: +210). */
function offsetMinutes(date, timeZone) {
  const z = zoned(date, timeZone);
  return Math.round((Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - Math.floor(date.getTime() / 1000) * 1000) / MIN);
}

/** The instant of wall-clock `minuteOfDay` on the zoned calendar day of `date` + `dayShift`. */
function atMinute(date, minuteOfDay, dayShift, timeZone) {
  const z = zoned(date, timeZone);
  const guess = Date.UTC(z.y, z.mo - 1, z.d + dayShift, 0, minuteOfDay);
  return new Date(guess - offsetMinutes(new Date(guess), timeZone) * MIN);
}

const inRange = (m, from, to) => (from <= to ? m >= from && m < to : m >= from || m < to);

/** The window `date` falls in. */
export function windowAt(date, cfg = DEFAULT_SCHEDULE) {
  const m = zoned(date, cfg.timeZone).minuteOfDay;
  return cfg.windows.find((w) => inRange(m, hhmm(w.from), hhmm(w.to))) ?? { name: 'none', sleep: true, minutes: {} };
}

/** Base interval of `task` in window `w` in minutes, or null when the task does not run there. */
export function intervalFor(task, w) {
  if (!w || w.sleep) return null;
  const v = Number(w.minutes?.[task]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Never exactly on a round hour: a start in the hour's first minute moves 2–9 minutes on. */
function offRound(t, cfg, rng) {
  return zoned(t, cfg.timeZone).mi === 0 ? new Date(t.getTime() + (2 + rng() * 7) * MIN) : t;
}

/**
 * The first moment at or after `t` where `task` may run: `t` itself if its window allows the task, else the start
 * of the next window that does, plus 1–wakeJitterMinutes random minutes.
 */
export function nextAllowed(task, t, cfg = DEFAULT_SCHEDULE, rng = Math.random) {
  if (intervalFor(task, windowAt(t, cfg)) !== null) return offRound(t, cfg, rng);
  const starts = [];
  for (const day of [0, 1, 2]) for (const w of cfg.windows) {
    if (intervalFor(task, w) === null) continue;
    const s = atMinute(t, hhmm(w.from), day, cfg.timeZone);
    if (s > t) starts.push(s);
  }
  starts.sort((a, b) => a - b);
  if (!starts.length) return null; // the task is switched off everywhere
  const wake = 1 + rng() * Math.max(0, cfg.wakeJitterMinutes - 1);
  return new Date(starts[0].getTime() + wake * MIN);
}

/**
 * When `task` should run next after a run at `from`: the window's base interval ± jitter, moved out of any window
 * where the task is off. A task asleep at `from` wakes at the next allowed start.
 */
export function nextRunAt(task, from, cfg = DEFAULT_SCHEDULE, rng = Math.random) {
  const base = intervalFor(task, windowAt(from, cfg));
  if (base === null) return nextAllowed(task, from, cfg, rng);
  const factor = 1 + (rng() * 2 - 1) * cfg.jitter;
  return nextAllowed(task, new Date(from.getTime() + base * factor * MIN), cfg, rng);
}

/** Every run each task would make in `hours` from `from` (for `sync:schedule --simulate`). */
export function simulate(from, hours, cfg = DEFAULT_SCHEDULE, rng = Math.random) {
  const end = from.getTime() + hours * 3600_000;
  const out = [];
  for (const task of TASKS) {
    let t = nextAllowed(task, from, cfg, rng);
    while (t && t.getTime() < end) {
      out.push({ task, at: t, window: windowAt(t, cfg).name });
      t = nextRunAt(task, t, cfg, rng);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Settings: DEFAULT_SCHEDULE ← env ← sync_settings rows ({key: value}). Unknown keys and bad values are ignored
 * (and reported), so a typo never stops the bot.
 */
export function resolveSchedule(env = {}, rows = {}) {
  const cfg = structuredClone(DEFAULT_SCHEDULE);
  const ignored = [];
  const src = { ...envSettings(env), ...rows };
  for (const [key, value] of Object.entries(src)) {
    try {
      if (key === 'paused') cfg.paused = value === true || value === 'true' || value === '1';
      else if (key === 'jitter' && Number(value) >= 0 && Number(value) <= 0.5) cfg.jitter = Number(value);
      else if (key === 'wake_jitter_minutes' && Number(value) >= 1 && Number(value) <= 60) cfg.wakeJitterMinutes = Number(value);
      else if (key === 'windows' && Array.isArray(value) && value.length) {
        value.forEach((w) => { hhmm(w.from); hhmm(w.to); });
        cfg.windows = value.map((w) => ({ name: String(w.name), from: w.from, to: w.to, sleep: !!w.sleep, minutes: w.minutes ?? {} }));
      } else if (/^(day|evening)_(catalog|hero|details)_minutes$/.test(key) && Number(value) > 0) {
        const [win, task] = key.split('_');
        cfg.windows.find((w) => w.name === win).minutes[task] = Number(value);
      } else ignored.push(key);
    } catch {
      ignored.push(key);
    }
  }
  return { cfg, ignored };
}

/** SYNC_* env variables → the same keys as sync_settings. */
function envSettings(env) {
  const out = {};
  if (env.SYNC_PAUSED) out.paused = env.SYNC_PAUSED;
  if (env.SYNC_JITTER) out.jitter = env.SYNC_JITTER;
  if (env.SYNC_WINDOWS) {
    try {
      out.windows = JSON.parse(env.SYNC_WINDOWS);
    } catch {
      out.windows_invalid = true;
    }
  }
  for (const w of ['day', 'evening']) for (const t of TASKS) {
    const v = env[`SYNC_${w.toUpperCase()}_${t.toUpperCase()}_MINUTES`];
    if (v) out[`${w}_${t}_minutes`] = v;
  }
  return out;
}

/** "07:12" in the schedule's zone (for logs and `sync:schedule`). */
export const clock = (date, cfg = DEFAULT_SCHEDULE) => {
  const z = zoned(date, cfg.timeZone);
  return `${String(z.h).padStart(2, '0')}:${String(z.mi).padStart(2, '0')}`;
};

/**
 * The worker's decision for one tick, from the stored schedule rows ({task: {next_run_at}}) and the clock only — so
 * a restart (same rows, any process) decides the same thing:
 *   init   tasks without a stored time → their first time (soon, inside an allowed window)
 *   due    tasks to run now (due, or due within `groupMs`, and allowed in the current window)
 *   defer  tasks due but not allowed now (settings changed) → their next allowed time
 */
export function dueTasks(rows, now, cfg = DEFAULT_SCHEDULE, { groupMs = 2 * MIN, rng = Math.random } = {}) {
  const init = {}, defer = {}, due = [];
  const w = windowAt(now, cfg);
  for (const task of TASKS) {
    const at = rows[task]?.next_run_at ? new Date(rows[task].next_run_at) : null;
    if (!at) {
      init[task] = nextAllowed(task, new Date(now.getTime() + (1 + rng() * 4) * MIN), cfg, rng);
      continue;
    }
    if (at.getTime() > now.getTime() + groupMs) continue;
    if (intervalFor(task, w) === null) defer[task] = nextAllowed(task, now, cfg, rng);
    else due.push(task);
  }
  return { init, due: cfg.paused ? [] : due, defer };
}
