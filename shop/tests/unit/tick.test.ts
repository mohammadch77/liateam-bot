// The order worker's rules, pure: who may call the tick, how a batch is walked (limit, time budget, one failure never stops the
// rest, locked orders skipped, no order advanced twice by two runs at once) and when an order counts as stuck.
// The database side (one stuck_alert per order) is in orders-db.test.mjs. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLocalRequest,
  runTick,
  sameSecret,
  stuckCutoff,
  tickAllowed,
  type TickOrder,
} from '../../src/lib/orders/tick.ts';

const SECRET = 'a'.repeat(32);
const headers = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
const orders = (n: number): TickOrder[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i + 1), number: `AV-${100001 + i}` }));

test('the secret is compared whole: equal passes, a different length or one wrong character does not', () => {
  assert.equal(sameSecret(SECRET, SECRET), true);
  assert.equal(sameSecret(SECRET.slice(1), SECRET), false);
  assert.equal(sameSecret(`${SECRET}x`, SECRET), false);
  assert.equal(sameSecret('b' + SECRET.slice(1), SECRET), false);
  assert.equal(sameSecret('', SECRET), false);
});

test('only the machine itself: nginx stamps X-Real-IP / X-Forwarded-For on everything it forwards, the script sends neither', () => {
  assert.equal(isLocalRequest(headers({})), true);
  assert.equal(isLocalRequest(headers({ 'x-real-ip': '127.0.0.1' })), true);
  assert.equal(isLocalRequest(headers({ 'x-real-ip': '::1', 'x-forwarded-for': '127.0.0.1' })), true);
  assert.equal(isLocalRequest(headers({ 'x-real-ip': '203.0.113.9' })), false);
  assert.equal(isLocalRequest(headers({ 'x-forwarded-for': '203.0.113.9' })), false);
  assert.equal(isLocalRequest(headers({ 'x-forwarded-for': '127.0.0.1, 203.0.113.9' })), false); // a chain with a stranger in it
  assert.equal(isLocalRequest(headers({ 'x-real-ip': '127.0.0.1', 'x-forwarded-for': '8.8.8.8' })), false);
});

test('the tick answers only with the configured secret, sent exactly, from the machine; everything else is «not found»', () => {
  assert.equal(tickAllowed(SECRET, headers({ 'x-cron-secret': SECRET })), true);
  assert.equal(tickAllowed(SECRET, headers({})), false); // no header
  assert.equal(tickAllowed(SECRET, headers({ 'x-cron-secret': 'wrong' })), false);
  assert.equal(tickAllowed(SECRET, headers({ 'x-cron-secret': '' })), false);
  assert.equal(tickAllowed(SECRET, headers({ 'x-cron-secret': SECRET, 'x-real-ip': '198.51.100.7' })), false); // right secret, from outside
  assert.equal(tickAllowed(undefined, headers({ 'x-cron-secret': SECRET })), false); // not configured: off
  assert.equal(tickAllowed('', headers({ 'x-cron-secret': '' })), false);
});

test('a batch stops at the limit and says where to continue', async () => {
  const seen: string[] = [];
  const r = await runTick({
    orders: orders(10),
    limit: 4,
    budgetMs: 1000,
    advance: async (o) => (seen.push(o.id), true),
  });
  assert.deepEqual(seen, ['1', '2', '3', '4']);
  assert.deepEqual([r.tried, r.advanced, r.stoppedBy, r.cursor], [4, 4, 'limit', '4']);
  const all = await runTick({ orders: orders(3), limit: 10, budgetMs: 1000, advance: async () => true });
  assert.deepEqual([all.tried, all.stoppedBy, all.cursor], [3, 'done', null]); // the list ended: start over next time
  const none = await runTick({ orders: [], limit: 10, budgetMs: 1000, advance: async () => true });
  assert.deepEqual([none.tried, none.stoppedBy], [0, 'done']);
});

test('a batch stops when its time is up (checked before each order, so a slow order is not cut in the middle)', async () => {
  let clock = 0;
  const r = await runTick({
    orders: orders(10),
    limit: 10,
    budgetMs: 25_000,
    now: () => clock,
    advance: async () => {
      clock += 10_000; // every order takes 10 s
      return true;
    },
  });
  assert.deepEqual([r.tried, r.stoppedBy, r.cursor], [3, 'budget', '3']); // 0 s, 10 s, 20 s start; at 30 s the budget is gone
});

test('one order failing never stops the others; the log gets its number and nothing else', async () => {
  const logged: Array<[string, unknown]> = [];
  const r = await runTick({
    orders: orders(5),
    limit: 10,
    budgetMs: 1000,
    advance: async (o) => {
      if (o.id === '2' || o.id === '4') throw new Error('boom: 09123456789 Test Customer');
      return true;
    },
    onError: (o, e) => logged.push([o.number, e]),
  });
  assert.deepEqual([r.tried, r.advanced, r.failed], [5, 3, 2]);
  assert.deepEqual(
    logged.map(([n]) => n),
    ['AV-100002', 'AV-100004'],
  );
  assert.ok(r.stoppedBy === 'done');
});

test('an order someone else is advancing is skipped, not waited for', async () => {
  const held = new Set(['2']);
  const r = await runTick({
    orders: orders(3),
    limit: 10,
    budgetMs: 1000,
    advance: async (o) => !held.has(o.id),
  });
  assert.deepEqual([r.advanced, r.skipped, r.failed], [2, 1, 0]);
});

test('two runs at once never advance the same order twice (a per-order try-lock)', async () => {
  const locked = new Set<string>();
  const moved = new Map<string, number>();
  const advance = async (o: TickOrder) => {
    if (locked.has(o.id)) return false; // pg_try_advisory_xact_lock: refused while another holds it
    locked.add(o.id);
    try {
      await new Promise((r) => setTimeout(r, 5)); // the work takes a moment: the other run arrives meanwhile
      moved.set(o.id, (moved.get(o.id) ?? 0) + 1);
      return true;
    } finally {
      locked.delete(o.id);
    }
  };
  const list = orders(20);
  const [a, b] = await Promise.all([
    runTick({ orders: list, limit: 100, budgetMs: 10_000, advance }),
    runTick({ orders: list, limit: 100, budgetMs: 10_000, advance }),
  ]);
  // every order was worked on at least once; whoever found it locked skipped it instead of doing it again at the same time
  assert.equal(moved.size, 20);
  assert.equal(
    a.advanced + b.advanced,
    [...moved.values()].reduce((x, y) => x + y, 0),
  );
  assert.ok(a.skipped + b.skipped > 0, 'the two runs overlapped');
  assert.equal(a.failed + b.failed, 0);
});

test('stuck: paid before now minus N minutes', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  assert.equal(stuckCutoff(30, now).toISOString(), '2026-03-01T11:30:00.000Z');
  assert.equal(stuckCutoff(1440, now).toISOString(), '2026-02-28T12:00:00.000Z');
});
