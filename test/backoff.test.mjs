import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, applyTrail, inBackoff, isBlockedResponse, onBlocked, onSuccess } from '../src/backoff.mjs';

const t0 = new Date('2026-10-20T10:00:00+03:30');
const later = (d, min) => new Date(d.getTime() + min * 60_000);
const waitMin = (s, now) => Math.round((new Date(s.until) - now) / 60_000);

test('blocked answers: 429, 403, 5xx and challenge pages; normal answers are not', () => {
  for (const s of [429, 403, 500, 502, 503, 504]) assert.equal(isBlockedResponse(s), true, String(s));
  for (const s of [200, 301, 307, 401, 404]) assert.equal(isBlockedResponse(s), false, String(s));
  assert.equal(isBlockedResponse(200, '<html><title>Just a moment…</title><script src="/cdn-cgi/challenge-platform/x"></script>'), true);
  assert.equal(isBlockedResponse(200, 'Please complete the captcha'), true);
  assert.equal(isBlockedResponse(200, '1:["$","$L12",null,{"products":[]}]'), false);
});

test('three in a row → 30 min; again → 60, 120, then capped at 240 min', () => {
  let s = { ...EMPTY };
  const waits = [];
  let now = t0;
  for (let round = 0; round < 6; round++) {
    let started = false;
    for (let i = 0; i < 3; i++) {
      const r = onBlocked(s, now, 'HTTP 429');
      s = r.state;
      if (i < 2) assert.equal(r.started, false);
      started = r.started;
    }
    assert.ok(started);
    waits.push(waitMin(s, now));
    assert.ok(inBackoff(s, later(now, waits.at(-1) - 1)));
    assert.ok(!inBackoff(s, later(now, waits.at(-1) + 1)));
    now = later(now, waits.at(-1) + 1); // the wait is over; blocked again right away
  }
  assert.deepEqual(waits, [30, 60, 120, 240, 240, 240]);
});

test('the first normal answer resets the count and the level', () => {
  let s = onBlocked(onBlocked({ ...EMPTY }, t0, 'x').state, t0, 'x').state; // 2 in a row
  assert.equal(s.consecutive, 2);
  const ok = onSuccess(s);
  assert.equal(ok.ended, false); // was not backing off yet
  s = ok.state;
  s = onBlocked(onBlocked(s, t0, 'x').state, t0, 'x').state;
  assert.equal(s.until, null); // 2 again, not 4: the count restarted
  // after a backoff: one normal answer → level 0, `ended`
  const backingOff = applyTrail({ ...EMPTY }, [{ blocked: true }, { blocked: true }, { blocked: true }], t0);
  assert.deepEqual(backingOff.started, [30]);
  const back = applyTrail(backingOff.state, [{ blocked: false }], later(t0, 31));
  assert.equal(back.ended, true);
  assert.deepEqual(back.state, { ...EMPTY });
  // and the next trouble starts from 30 again
  assert.deepEqual(applyTrail(back.state, Array(3).fill({ blocked: true }), t0).started, [30]);
});

test('a run\'s answers in order: blocks across runs add up; a success in between breaks the row', () => {
  const run1 = applyTrail({ ...EMPTY }, [{ blocked: false }, { blocked: true }, { blocked: true }], t0);
  assert.equal(run1.state.consecutive, 2);
  assert.deepEqual(run1.started, []);
  const run2 = applyTrail(run1.state, [{ blocked: true }], t0); // the 3rd in a row, one run later
  assert.deepEqual(run2.started, [30]);
  const mixed = applyTrail({ ...EMPTY }, [{ blocked: true }, { blocked: true }, { blocked: false }, { blocked: true }], t0);
  assert.equal(mixed.state.consecutive, 1);
  assert.deepEqual(mixed.started, []);
});

test('inside a run: the 3rd refusal in a row (counting the previous run) stops it at once', async () => {
  const { responses, BlockedError } = await import('../src/source.mjs');
  responses.trail = [];
  responses.prior = 1; // one refusal at the end of the previous run
  responses.note(200, '1:["$"]', 'listing page 1'); // a normal answer breaks the row: prior no longer counts
  responses.note(503, '', 'listing page 2');
  responses.note(503, '', 'listing page 3');
  assert.throws(() => responses.note(429, '', 'listing page 4'), BlockedError);
  responses.trail = [];
  responses.prior = 2;
  assert.throws(() => responses.note(403, '', 'home page'), BlockedError); // 2 before + this one
});
