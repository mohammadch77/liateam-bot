import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as bot from '../src/schedule-rules.mjs';
import * as panel from '../dashboard/lib/scheduleRules.mjs';
import { dueTasks, resolveSchedule, scheduleSummary, simulate, windowAt, zoned } from '../src/scheduler.mjs';

const at = (hm, day = '2026-10-20') => new Date(`${day}T${hm}:00+03:30`);

test('the dashboard copy is the bot\'s rules file (same code below the header)', () => {
  const body = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').slice(4).join('\n');
  assert.equal(body('../dashboard/lib/scheduleRules.mjs'), body('../src/schedule-rules.mjs'));
});

for (const [name, r] of [['bot', bot], ['dashboard', panel]]) {
  test(`${name}: minimum intervals (catalog 30, hero 15, details 60; env can raise or lower them)`, () => {
    assert.equal(r.checkInterval('catalog', 30), null);
    assert.match(r.checkInterval('catalog', 29), /کمتر از ۳۰ دقیقه/);
    assert.match(r.checkInterval('catalog', 29), /مسدود شدن حساب شما در لیاتیم/);
    assert.equal(r.checkInterval('hero', 15), null);
    assert.match(r.checkInterval('hero', 14), /۱۵/);
    assert.equal(r.checkInterval('details', 60), null);
    assert.match(r.checkInterval('details', 59), /۶۰/);
    assert.match(r.checkInterval('catalog', 1441), /حداکثر/);
    assert.match(r.checkInterval('catalog', 45.5), /عدد صحیح/);
    assert.ok(r.checkInterval('nope', 60));
    const env = { SYNC_MIN_CATALOG_MINUTES: '45', SYNC_MIN_HERO_MINUTES: 'junk' };
    assert.match(r.checkInterval('catalog', 40, env), /۴۵/);
    assert.equal(r.checkInterval('hero', 15, env), null); // a bad env value keeps the default
  });

  test(`${name}: windows go round the clock — no overlap, no hole, the night always stays`, () => {
    const ok = { day_start: '07:00', evening_start: '19:00', night_start: '23:00' };
    assert.equal(r.checkWindows(ok), null);
    assert.equal(r.checkWindows({ day_start: '08:30', evening_start: '18:00', night_start: '01:00' }), null); // night after midnight
    // out of order = overlapping windows
    assert.match(r.checkWindows({ day_start: '07:00', evening_start: '23:00', night_start: '19:00' }), /بدون هم‌پوشانی/);
    assert.match(r.checkWindows({ day_start: '07:00', evening_start: '06:00', night_start: '23:00' }), /بدون هم‌پوشانی/);
    // the night cannot be removed or squeezed
    assert.match(r.checkWindows({ day_start: '07:00', evening_start: '19:00', night_start: '07:00' }), /بدون هم‌پوشانی|حذف نمی‌شود/);
    assert.match(r.checkWindows({ day_start: '07:00', evening_start: '19:00', night_start: '06:30' }), /خواب شبانه حذف نمی‌شود/);
    // day and evening at least 30 min each
    assert.match(r.checkWindows({ day_start: '07:00', evening_start: '07:10', night_start: '23:00' }), /حداقل/);
    assert.match(r.checkWindows({ ...ok, day_start: '7:00' }), /به شکل/);
  });
}

test('the bot applies only what the rules allow: below-minimum intervals and bad windows are ignored', () => {
  const { cfg, ignored } = resolveSchedule({}, {
    day_catalog_minutes: 20, // below 30
    evening_hero_minutes: 10, // below 15
    day_details_minutes: 120,
    day_start: '07:00', evening_start: '06:00', night_start: '23:00', // overlapping
  });
  const w = Object.fromEntries(cfg.windows.map((x) => [x.name, x]));
  assert.equal(w.day.minutes.catalog, 60);
  assert.equal(w.evening.minutes.hero, 30);
  assert.equal(w.day.minutes.details, 120);
  assert.deepEqual([w.day.from, w.evening.from, w.night.from], ['07:00', '19:00', '23:00']);
  assert.deepEqual(ignored.sort(), ['day_catalog_minutes', 'day_start', 'evening_hero_minutes', 'evening_start', 'night_start']);
});

test('saved settings change what sync:schedule shows and simulates (windows + intervals)', () => {
  const rows = { day_start: '08:00', evening_start: '18:00', night_start: '22:00', day_catalog_minutes: 90, day_hero_minutes: 45 };
  const { cfg, ignored } = resolveSchedule({}, rows);
  assert.deepEqual(ignored, []);
  assert.deepEqual(scheduleSummary(cfg).windows.map((x) => [x.name, x.from, x.to]),
    [['day', '08:00', '18:00'], ['evening', '18:00', '22:00'], ['night', '22:00', '08:00']]);
  assert.equal(windowAt(at('07:30'), cfg).name, 'night'); // asleep until 08:00 now
  const runs = simulate(at('00:00'), 24, cfg);
  for (const x of runs) {
    const z = zoned(x.at);
    assert.ok(z.minuteOfDay >= 8 * 60 && z.minuteOfDay < 22 * 60, `${x.task} at ${z.h}:${z.mi}`);
  }
  const catalogDay = runs.filter((x) => x.task === 'catalog' && windowAt(x.at, cfg).name === 'day');
  for (let i = 1; i < catalogDay.length; i++) {
    const gap = (catalogDay[i].at - catalogDay[i - 1].at) / 60_000;
    assert.ok(gap >= 72 && gap <= 108 + 9, `day catalog gap ${gap}`); // 90 ± 20 %
  }
});

test('pause / resume: paused → nothing due; resumed → the stored times run again', () => {
  const rows = { catalog: { next_run_at: at('10:00') }, hero: { next_run_at: at('10:01') }, details: { next_run_at: at('15:00') } };
  const paused = resolveSchedule({}, { paused: true }).cfg;
  assert.deepEqual(dueTasks(rows, at('10:05'), paused).due, []);
  const resumed = resolveSchedule({}, { paused: false }).cfg;
  assert.deepEqual(dueTasks(rows, at('10:05'), resumed).due.sort(), ['catalog', 'hero']);
});
