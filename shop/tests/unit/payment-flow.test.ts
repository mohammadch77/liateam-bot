// Pure decisions of the payment flow: what a gateway return may tell us (an amount never), placing now or waiting, how the bot's
// status maps onto the shop's order (always along the status machine), tracking codes, usable payment methods, and the
// multi-level commission of a paid order. No database, no network. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommissions } from '../../src/lib/commission/engine.ts';
import { DEV_SIMULATOR_PATH } from '../../src/lib/payment/dev.ts';
import {
  MIN_HOLD_LEFT_MS,
  botPath,
  canStartPayment,
  defaultMethod,
  holdLeft,
  methodUsable,
  parseCallbackQuery,
  placementPlan,
  tehranMinutes,
  trackingCode,
} from '../../src/lib/orders/payment-flow.ts';
import { ORDER_STATUSES, canMove, type OrderStatus } from '../../src/lib/orders/status.ts';
import { paymentCallbackPath, paymentSimulatorPath } from '../../src/lib/urls.ts';

// ── what the gateway's return may say ──
test('the return is read for its authority and OK / NOK only: an amount, an order number or a status of ours is ignored', () => {
  const r = parseCallbackQuery({
    Authority: 'A00000000000000000000000000123',
    Status: 'OK',
    amount: '1',
    order: 'AV-100001',
    total_payable: '5',
  });
  assert.deepEqual(r, { authority: 'A00000000000000000000000000123', status: 'OK', sim: null });
  assert.deepEqual(Object.keys(r).sort(), ['authority', 'sim', 'status']);
  assert.equal(parseCallbackQuery({ Authority: 'abc123', Status: 'nok' }).status, 'NOK');
  assert.equal(parseCallbackQuery({ Authority: 'abc123', Status: 'paid' }).status, null);
  assert.equal(parseCallbackQuery({ Authority: ['ABC123456', 'x'], Status: 'OK' }).authority, 'ABC123456');
});

test('a bad authority is not an authority (no injection into a lookup, no empty one)', () => {
  for (const bad of ['', 'ab', "x' OR '1'='1", 'a b c d e f g', '../../etc', 'A'.repeat(61), undefined])
    assert.equal(
      parseCallbackQuery({ Authority: bad as string | undefined, Status: 'OK' }).authority,
      null,
      String(bad),
    );
  assert.equal(parseCallbackQuery({}).authority, null);
  assert.equal(parseCallbackQuery({ Authority: 'DEVABCDEF1', sim: 'success' }).sim, 'success');
  assert.equal(parseCallbackQuery({ Authority: 'DEVABCDEF1', sim: 'hack' }).sim, null);
});

test('the simulator and callback addresses are the ones the dev adapter and the pages use', () => {
  assert.equal(paymentSimulatorPath(), DEV_SIMULATOR_PATH);
  assert.equal(paymentCallbackPath(), '/payment/callback');
});

// ── placing ──
test('Tehran wall clock minutes (UTC+3:30 in winter, UTC+3:30 all year since 2022)', () => {
  assert.equal(tehranMinutes(new Date('2026-01-10T08:00:00Z')), 11 * 60 + 30);
  assert.equal(tehranMinutes(new Date('2026-07-10T20:45:00Z')), 0 * 60 + 15); // past midnight there
});

test('a paid order is placed now only when automatic placing is on AND now is inside the working hours', () => {
  const hours = { from: '09:00', to: '21:00' };
  const noon = new Date('2026-01-10T08:30:00Z'); // 12:00 in Tehran
  const night = new Date('2026-01-10T20:30:00Z'); // 00:00 in Tehran
  assert.equal(placementPlan({ autoPlaceEnabled: true, autoPlaceHours: hours }, noon), 'place_now');
  assert.equal(placementPlan({ autoPlaceEnabled: true, autoPlaceHours: hours }, night), 'wait_hours');
  assert.equal(placementPlan({ autoPlaceEnabled: false, autoPlaceHours: hours }, noon), 'wait_auto_off');
  assert.equal(
    placementPlan({ autoPlaceEnabled: true, autoPlaceHours: { from: '22:00', to: '06:00' } }, night),
    'place_now',
  ); // wraps midnight
  assert.equal(
    placementPlan({ autoPlaceEnabled: true, autoPlaceHours: { from: '09:00', to: '09:00' } }, night),
    'place_now',
  ); // 24 hours
});

// ── status transitions ──
test('the shop follows the bot only along the status machine, step by step when the bot was faster', () => {
  assert.deepEqual(botPath('queued', 'awaiting_payment'), ['awaiting_payment']);
  assert.deepEqual(botPath('queued', 'needs_review'), ['needs_review']);
  assert.deepEqual(botPath('queued', 'canceled'), ['canceled']);
  assert.deepEqual(botPath('queued', 'sent'), ['awaiting_payment', 'sent']); // not allowed directly, one step between
  assert.deepEqual(botPath('queued', 'supplier_paid'), ['awaiting_payment', 'supplier_paid']);
  assert.deepEqual(botPath('needs_review', 'queued'), ['queued']); // the operator re-queued it
  assert.deepEqual(botPath('supplier_paid', 'sent'), ['sent']);
  for (const nothing of [
    botPath('queued', 'queued'),
    botPath('sent', 'queued'),
    botPath('canceled', 'sent'),
    botPath('queued', 'pending_payment'),
    botPath('queued', 'bogus'),
    botPath('queued', null),
  ])
    assert.deepEqual(nothing, []);
});

test('every step botPath returns is a legal move; paying or a final state is never reached by accident', () => {
  for (const from of ORDER_STATUSES)
    for (const to of ORDER_STATUSES) {
      const path = botPath(from, to);
      let at: OrderStatus = from;
      for (const step of path) {
        assert.ok(canMove(at, step), `${at} -> ${step}`);
        at = step;
      }
      if (path.length) assert.equal(at, to);
      assert.ok(!path.includes('pending_payment'));
    }
});

test('only an order waiting for payment can start one', () => {
  assert.equal(canStartPayment('pending_payment'), true);
  for (const s of ORDER_STATUSES.filter((x) => x !== 'pending_payment'))
    assert.equal(canStartPayment(s), false, s);
});

test('a payment starts only while the live check still holds for a couple of minutes', () => {
  const now = new Date('2026-03-01T10:00:00Z');
  assert.equal(holdLeft(new Date(now.getTime() + MIN_HOLD_LEFT_MS), now), true);
  assert.equal(holdLeft(new Date(now.getTime() + MIN_HOLD_LEFT_MS - 1), now), false);
  assert.equal(holdLeft(new Date(now.getTime() - 1000), now), false);
  assert.equal(holdLeft(null, now), false);
});

// ── methods and tracking ──
test('payment methods: online needs the settings, the wallet needs the money; the default is the one that works', () => {
  const on = { online: true, walletBalance: 0 };
  const off = { online: false, walletBalance: 300_000 };
  assert.equal(methodUsable('gateway', on, 100_000), true);
  assert.equal(methodUsable('wallet', on, 100_000), false);
  assert.equal(methodUsable('gateway', off, 100_000), false);
  assert.equal(methodUsable('wallet', off, 100_000), true);
  assert.equal(methodUsable('wallet', off, 300_001), false);
  assert.equal(methodUsable('wallet', off, 300_000), true); // exactly enough
  assert.equal(methodUsable('wallet', off, 0), false);
  assert.equal(methodUsable('wallet', off, null), true);
  assert.equal(defaultMethod({ online: true, walletBalance: 999_999 }, 1000), 'gateway');
  assert.equal(defaultMethod(off, 1000), 'wallet');
  assert.equal(defaultMethod({ online: false, walletBalance: 5 }, 1000), 'gateway'); // none works: online, shown disabled
});

test('a tracking code is read from the shapes the bot may store, never invented', () => {
  assert.equal(trackingCode('9912345'), '9912345');
  assert.equal(trackingCode({ code: 'R-77' }), 'R-77');
  assert.equal(trackingCode({ tracking_code: 5551 }), '5551');
  assert.equal(trackingCode({ unknown: 'x' }), '');
  assert.equal(trackingCode(null), '');
  assert.equal(trackingCode(42), '');
  assert.equal(trackingCode('x'.repeat(100)).length, 60);
});

// ── the commission of a paid order: the engine as the payment flow calls it ──
test('a paid order with a three-level chain: each referrer once, rounded down, pending with the hold; cancel zeroes them', () => {
  const rules = [
    {
      id: 1,
      name: 'l1',
      scope: { type: 'all' as const },
      level: 1,
      kind: 'percent' as const,
      value: 5,
      minOrderTotal: 0,
      maxPerOrder: null,
      holdDays: 7,
      active: true,
    },
    {
      id: 2,
      name: 'l2',
      scope: { type: 'all' as const },
      level: 2,
      kind: 'percent' as const,
      value: 2.5,
      minOrderTotal: 0,
      maxPerOrder: null,
      holdDays: 14,
      active: true,
    },
    {
      id: 3,
      name: 'l3',
      scope: { type: 'all' as const },
      level: 3,
      kind: 'fixed' as const,
      value: 3_000,
      minOrderTotal: 0,
      maxPerOrder: null,
      holdDays: 0,
      active: true,
    },
  ];
  const lines = [
    { productId: 1, brandId: null, categoryIds: [], lineTotal: 333_333 },
    { productId: 2, brandId: null, categoryIds: [], lineTotal: 100_001 },
  ];
  const now = new Date('2026-03-01T10:00:00Z');
  const paid = calculateCommissions(
    { status: 'paid', createdAt: now, lines },
    rules,
    ['a', 'b', 'c', 'd'],
    now,
  );
  assert.deepEqual(
    paid.items.map((i) => [i.level, i.affiliateUserId, i.amount, i.holdDays, i.status]),
    [
      [1, 'a', 21_666, 7, 'pending'], // 433,334 x 5% = 21,666.7 -> 21,666
      [2, 'b', 10_833, 14, 'pending'], // x 2.5% = 10,833.35 -> 10,833
      [3, 'c', 3_000, 0, 'pending'],
    ],
  );
  assert.equal(new Set(paid.items.map((i) => i.affiliateUserId)).size, paid.items.length); // one per referrer
  assert.deepEqual(
    paid.skipped.map((s) => [s.level, s.reason]),
    [[4, 'no_rule']],
  );
  const dead = calculateCommissions(
    { status: 'canceled', createdAt: now, lines },
    rules,
    ['a', 'b', 'c'],
    now,
  );
  assert.ok(dead.items.every((i) => i.status === 'cancelled' && i.amount === 0));
  // no rule at all, or nobody above the buyer: no commission and no failure
  assert.deepEqual(calculateCommissions({ status: 'paid', createdAt: now, lines }, [], ['a'], now).items, []);
  assert.deepEqual(calculateCommissions({ status: 'paid', createdAt: now, lines }, rules, [], now).items, []);
});
