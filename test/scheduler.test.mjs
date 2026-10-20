import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEDULE, TASKS, clock, dueTasks, nextAllowed, nextRunAt, resolveSchedule, simulate, windowAt, zoned } from '../src/scheduler.mjs';

// Fake clock: Tehran wall time → instant (Tehran is UTC+3:30 all year since 2022).
const at = (hm, day = '2026-10-20') => new Date(`${day}T${hm}:00+03:30`);
const minutesBetween = (a, b) => (b - a) / 60_000;
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const cfg = DEFAULT_SCHEDULE;

test('window detection at the edges (Tehran time)', () => {
  const cases = [['06:59', 'night'], ['07:00', 'day'], ['12:00', 'day'], ['18:59', 'day'], ['19:00', 'evening'],
    ['22:59', 'evening'], ['23:00', 'night'], ['00:00', 'night'], ['03:30', 'night']];
  for (const [hm, name] of cases) assert.equal(windowAt(at(hm)).name, name, hm);
});

test('next run = base interval ± 20 %: day catalog 60 → 48…72 min, details 180 → 144…216', () => {
  const lo = nextRunAt('catalog', at('10:10'), cfg, seq(0)); // factor 0.8
  const hi = nextRunAt('catalog', at('10:10'), cfg, seq(0.999999)); // factor ~1.2
  assert.equal(Math.round(minutesBetween(at('10:10'), lo)), 48);
  assert.equal(Math.round(minutesBetween(at('10:10'), hi)), 72);
  const d = nextRunAt('details', at('10:10'), cfg, seq(0.5));
  assert.equal(Math.round(minutesBetween(at('10:10'), d)), 180);
  // evening catalog (240): 19:10 + 240 = 23:10 is asleep → the next morning
  assert.equal(zoned(nextRunAt('catalog', at('19:10'), cfg, seq(0.5, 0.5))).h, 7);
  for (let i = 0; i < 500; i++) {
    const m = minutesBetween(at('09:13'), nextRunAt('catalog', at('09:13')));
    assert.ok(m >= 48 && m <= 72 + 9, `${m}`); // +up to 9 when it would start on a round hour
  }
});

test('a run that would fall into the night moves to 07:00 + 1…15 min the next morning', () => {
  // evening 21:00 + 240 min = 01:00 → asleep → next morning
  const t = nextRunAt('catalog', at('21:00'), cfg, seq(0.5, 0.5));
  const z = zoned(t);
  assert.equal(z.d, 21);
  assert.ok(z.h === 7 && z.mi >= 1 && z.mi <= 15, clock(t));
  // banners at 22:50 + ~30 min = 23:20 → asleep → next morning too
  assert.equal(zoned(nextRunAt('hero', at('22:50'), cfg, seq(0.5, 0.2))).h, 7);
  // asleep now (03:00): wake at the next allowed start
  for (const task of TASKS) {
    const w = nextAllowed(task, at('03:00'), cfg);
    assert.ok(zoned(w).h === 7 && zoned(w).mi >= 1 && zoned(w).mi <= 15, `${task} ${clock(w)}`);
  }
});

test('never at night, never exactly on a round hour (200 simulated days)', () => {
  for (let d = 0; d < 200; d++) {
    for (const r of simulate(at('00:00'), 24)) {
      assert.ok(!windowAt(r.at).sleep, `${r.task} at ${clock(r.at)} (night)`);
      assert.notEqual(zoned(r.at).mi, 0, `${r.task} at ${clock(r.at)} (round hour)`);
    }
  }
});

test('restart: the stored next times decide, not the process — same plan before and after a restart', () => {
  const rows = { catalog: { next_run_at: at('10:30') }, hero: { next_run_at: at('10:50') }, details: { next_run_at: at('12:00') } };
  const now = at('10:31');
  const before = dueTasks(rows, now, cfg, { rng: seq(0.3) });
  const after = dueTasks(structuredClone(rows), new Date(now), cfg, { rng: seq(0.9) }); // "new process", other randomness
  assert.deepEqual(before.due, ['catalog']);
  assert.deepEqual(after.due, before.due);
  assert.deepEqual(after.init, {});
  // hero due within 2 minutes joins the run; a far one does not
  assert.deepEqual(dueTasks(rows, at('10:49'), cfg).due.sort(), ['catalog', 'hero']);
  // a task with no stored time gets one inside an allowed window, never right away at night
  const fresh = dueTasks({}, at('02:00'), cfg, { rng: seq(0.5) });
  assert.deepEqual(fresh.due, []);
  for (const task of TASKS) assert.equal(zoned(fresh.init[task]).h, 7);
});

test('due at night (settings changed) → deferred to the morning; paused → nothing runs', () => {
  const rows = { catalog: { next_run_at: at('23:10') }, hero: { next_run_at: at('23:10') }, details: { next_run_at: at('23:10') } };
  const plan = dueTasks(rows, at('23:15'), cfg);
  assert.deepEqual(plan.due, []);
  for (const task of TASKS) assert.equal(zoned(plan.defer[task]).h, 7);
  const paused = resolveSchedule({}, { paused: true }).cfg;
  assert.deepEqual(dueTasks({ catalog: { next_run_at: at('10:00') } }, at('10:05'), paused).due, []);
});

test('settings: env and sync_settings override the defaults; bad keys are reported, not fatal', () => {
  const { cfg: c, ignored } = resolveSchedule(
    { SYNC_DAY_CATALOG_MINUTES: '45', SYNC_JITTER: '0.1' },
    { evening_hero_minutes: 60, paused: false, typo_key: 1, windows: 'oops' });
  assert.equal(c.windows.find((w) => w.name === 'day').minutes.catalog, 45);
  assert.equal(c.windows.find((w) => w.name === 'evening').minutes.hero, 60);
  assert.equal(c.jitter, 0.1);
  assert.deepEqual(ignored.sort(), ['typo_key', 'windows']);
});

test('panel / bot keys: window starts move both neighbouring windows, «both windows» intervals, order-independent', async () => {
  const { validScheduleValue, scheduleSummary } = await import('../src/scheduler.mjs');
  const rows = { day_catalog_minutes: 90, hero_minutes: 20, night_start: '22:30', day_start: '08:00', catalog_minutes: 45 };
  const a = resolveSchedule({}, rows).cfg;
  const b = resolveSchedule({}, Object.fromEntries(Object.entries(rows).reverse())).cfg;
  assert.deepEqual(scheduleSummary(a), scheduleSummary(b));
  const w = Object.fromEntries(a.windows.map((x) => [x.name, x]));
  assert.deepEqual([w.day.from, w.day.to, w.evening.from, w.evening.to, w.night.from, w.night.to],
    ['08:00', '19:00', '19:00', '22:30', '22:30', '08:00']);
  assert.equal(w.day.minutes.catalog, 90); // one window beats «both windows»
  assert.equal(w.evening.minutes.catalog, 45);
  assert.equal(w.day.minutes.hero, 20);
  assert.equal(w.evening.minutes.hero, 20);
  assert.equal(windowAt(at('07:30'), a).name, 'night'); // asleep until 08:00 now
  assert.equal(windowAt(at('22:45'), a).name, 'night');
  // the same limits the panel and the bots check before saving
  assert.equal(validScheduleValue('day_start', '08:00'), true);
  assert.equal(validScheduleValue('day_start', '8:00'), false);
  assert.equal(validScheduleValue('hero_minutes', 5), false);
  assert.equal(validScheduleValue('hero_minutes', 30), true);
  assert.equal(validScheduleValue('paused', 'yes'), false);
  assert.equal(validScheduleValue('anything', 1), false);
});
