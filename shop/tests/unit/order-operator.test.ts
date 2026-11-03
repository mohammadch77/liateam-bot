// The operator's order rules, pure: which action each status allows (and refuses), what a needs_review stop means in money, the
// 20-minute payment link's margins, the inputs, the open cancel request, and the admin list's search. The locks, the ledger and
// the bot happen in order-operator.service (admin-orders e2e and orders-db.test.mjs). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_STATUSES, type OrderStatus } from '../../src/lib/orders/status.ts';
import {
  adminSortOf,
  adminStatusFilterOf,
  allowedActions,
  canDo,
  hasOpenCancelRequest,
  linkClock,
  parseDay,
  parseOrderSearch,
  parseText,
  parseTrackingCode,
  reviewKindOf,
  reviewSaving,
  type OperatorAction,
  type OperatorContext,
} from '../../src/lib/orders/operator.ts';

const ctx = (status: OrderStatus, over: Partial<OperatorContext> = {}): OperatorContext => ({
  status,
  openCancelRequest: false,
  hasBotOrder: true,
  reviewKind: null,
  ...over,
});
const set = (c: OperatorContext) => [...allowedActions(c)].sort();

test('every status allows exactly its own actions (note always)', () => {
  const expected: Record<OrderStatus, OperatorAction[]> = {
    pending_payment: ['note'],
    queued: ['cancel', 'note', 'place'],
    placing: ['note'],
    awaiting_payment: ['cancel', 'mark_paid', 'note'],
    needs_review: ['cancel', 'note', 'recheck'],
    supplier_paid: ['manual_return', 'note', 'ship'],
    sent: ['manual_return', 'note'],
    refunded: ['note'],
    canceled: ['note'],
  };
  for (const s of ORDER_STATUSES) assert.deepEqual(set(ctx(s)), [...expected[s]].sort(), s);
});

test('cancelling by the operator is impossible once the supplier is paid, and sending only after the supplier is paid', () => {
  for (const s of ['supplier_paid', 'sent', 'canceled', 'refunded', 'placing', 'pending_payment'] as const)
    assert.equal(canDo('cancel', ctx(s)), false, s);
  for (const s of ORDER_STATUSES) assert.equal(canDo('ship', ctx(s)), s === 'supplier_paid', s);
  for (const s of ORDER_STATUSES) assert.equal(canDo('mark_paid', ctx(s)), s === 'awaiting_payment', s);
});

test('a customer cancel request: approve only while the order is waiting for payment, reject while placing or waiting; none without a request', () => {
  for (const s of ORDER_STATUSES) {
    assert.equal(canDo('approve_cancel', ctx(s)), false);
    assert.equal(canDo('reject_cancel', ctx(s)), false);
  }
  assert.equal(canDo('approve_cancel', ctx('awaiting_payment', { openCancelRequest: true })), true);
  assert.equal(canDo('approve_cancel', ctx('placing', { openCancelRequest: true })), false); // the bot is placing it right now
  assert.equal(canDo('reject_cancel', ctx('placing', { openCancelRequest: true })), true);
  assert.equal(canDo('reject_cancel', ctx('awaiting_payment', { openCancelRequest: true })), true);
  assert.equal(canDo('reject_cancel', ctx('supplier_paid', { openCancelRequest: true })), false);
});

test('place and recheck need the bot order; continuing needs a price that did not rise and nothing missing', () => {
  assert.equal(canDo('place', ctx('queued', { hasBotOrder: false })), false);
  assert.equal(canDo('recheck', ctx('needs_review', { hasBotOrder: false })), false);
  assert.equal(canDo('continue_review', ctx('needs_review', { reviewKind: 'price_up' })), false);
  assert.equal(canDo('continue_review', ctx('needs_review', { reviewKind: 'unavailable' })), false);
  assert.equal(canDo('continue_review', ctx('needs_review', { reviewKind: 'unknown' })), false);
  assert.equal(canDo('continue_review', ctx('needs_review', { reviewKind: 'price_down' })), true);
  assert.equal(canDo('continue_review', ctx('needs_review', { reviewKind: 'price_same' })), true);
  assert.equal(canDo('continue_review', ctx('queued', { reviewKind: 'price_down' })), false);
});

test('the manual return is allowed only after the supplier is paid', () => {
  for (const s of ORDER_STATUSES) assert.equal(canDo('manual_return', ctx(s)), s === 'supplier_paid' || s === 'sent', s);
});

test('review kinds from the bot numbers', () => {
  const k = (live: number | null, expected: number | null, missing = 0, reason: string | null = 'price') =>
    reviewKindOf({ reason, live, expected, missing });
  assert.equal(k(1_100_000, 1_000_000), 'price_up');
  assert.equal(k(900_000, 1_000_000), 'price_down');
  assert.equal(k(1_000_000, 1_000_000), 'price_same');
  assert.equal(k(900_000, 1_000_000, 1), 'unavailable');
  assert.equal(k(900_000, 1_000_000, 0, 'unavailable'), 'unavailable');
  assert.equal(k(null, 1_000_000), 'unknown');
  assert.equal(k(900_000, null), 'unknown');
});

test('the saving to the wallet: the drop in price, minus what was already given, never negative, never above the payment', () => {
  assert.equal(reviewSaving(1_000_000, 900_000, 0, 1_200_000), 100_000);
  assert.equal(reviewSaving(1_000_000, 900_000, 100_000, 1_200_000), 0); // the same drop is not given twice
  assert.equal(reviewSaving(1_000_000, 850_000, 100_000, 1_200_000), 50_000); // a further drop is
  assert.equal(reviewSaving(1_000_000, 1_000_000, 0, 1_200_000), 0);
  assert.equal(reviewSaving(1_000_000, 1_200_000, 0, 1_200_000), 0); // a rise gives nothing
  assert.equal(reviewSaving(1_000_000, 0, 0, 500_000), 500_000); // capped at what the customer paid
  assert.equal(reviewSaving(null, 900_000, 0, 1_200_000), 0);
  assert.equal(reviewSaving(1_000_000, null, 0, 1_200_000), 0);
});

test('the payment link clock: active, expiring on the remind margin, expired at the end, none without a link', () => {
  const issued = new Date('2026-01-01T10:00:00Z');
  const at = (min: number, sec = 0) => new Date(issued.getTime() + min * 60_000 + sec * 1000);
  assert.equal(linkClock(issued, 20, 5, at(0)).state, 'active');
  assert.equal(linkClock(issued, 20, 5, at(14, 59)).state, 'active');
  assert.equal(linkClock(issued, 20, 5, at(15)).state, 'expiring'); // exactly 5 minutes left
  assert.equal(linkClock(issued, 20, 5, at(19, 59)).state, 'expiring');
  assert.equal(linkClock(issued, 20, 5, at(20)).state, 'expired'); // exactly at the end
  assert.equal(linkClock(issued, 20, 5, at(45)).state, 'expired');
  assert.equal(linkClock(issued, 20, 5, at(45)).msLeft, 0);
  assert.equal(linkClock(issued, 20, 5, at(10)).msLeft, 10 * 60_000);
  assert.equal(linkClock(issued, 20, 5, at(10)).expiresAt?.toISOString(), '2026-01-01T10:20:00.000Z');
  assert.equal(linkClock(null, 20, 5, at(1)).state, 'none');
  assert.equal(linkClock(issued, 20, 5, at(1), false).state, 'none'); // the order is not waiting for payment
  assert.equal(linkClock(issued, 30, 10, at(21)).state, 'expiring'); // other settings
});

test('tracking codes: letters, digits and dashes, 5 to 40; Persian digits are read', () => {
  assert.equal(parseTrackingCode('  RR123456789IR '), 'RR123456789IR');
  assert.equal(parseTrackingCode('۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹۰۱۲'), '1234567890123456789012');
  assert.equal(parseTrackingCode('1234'), null);
  assert.equal(parseTrackingCode('a'.repeat(41)), null);
  assert.equal(parseTrackingCode('12 345 678'), null);
  assert.equal(parseTrackingCode("123'; drop"), null);
  assert.equal(parseTrackingCode(null), null);
  assert.equal(parseTrackingCode({}), null);
});

test('free text: trimmed, bounded, no control characters', () => {
  assert.equal(parseText('  سلام  ', 1, 10), 'سلام');
  assert.equal(parseText('', 1, 10), null);
  assert.equal(parseText('   ', 1, 10), null);
  assert.equal(parseText('abcd', 5, 10), null);
  assert.equal(parseText('a'.repeat(11), 1, 10), null);
  assert.equal(parseText('a\u0000b', 1, 10), null);
  assert.equal(parseText('خط۱\nخط۲', 1, 20), 'خط۱\nخط۲');
  assert.equal(parseText(5, 1, 10), null);
});

test('an open cancel request: asked and not answered; an answer closes it', () => {
  const ev = (...kinds: string[]) => kinds.map((kind) => ({ kind }));
  assert.equal(hasOpenCancelRequest(ev()), false);
  assert.equal(hasOpenCancelRequest(ev('paid', 'cancel_requested')), true);
  assert.equal(hasOpenCancelRequest(ev('cancel_requested', 'cancel_request_rejected')), false);
  assert.equal(hasOpenCancelRequest(ev('cancel_requested', 'cancel_request_approved')), false);
  assert.equal(hasOpenCancelRequest(ev('cancel_requested', 'cancel_request_rejected', 'cancel_requested')), true);
});

test('the list search: an order number, digits of one, or a mobile; anything else finds nothing; the sort and status keys are a whitelist', () => {
  assert.deepEqual(parseOrderSearch('AV-100001'), { number: 'AV-100001', phone: null, empty: false });
  assert.deepEqual(parseOrderSearch(' av100001 '), { number: 'AV-100001', phone: null, empty: false });
  assert.deepEqual(parseOrderSearch('100001'), { number: 'AV-100001', phone: null, empty: false });
  assert.deepEqual(parseOrderSearch('۰۹۱۲۳۴۵۶۷۸۹'), { number: null, phone: '09123456789', empty: false });
  assert.deepEqual(parseOrderSearch('09123456789'), { number: null, phone: '09123456789', empty: false });
  assert.equal(parseOrderSearch("x' or 1=1 --").number, '');
  assert.equal(parseOrderSearch('').empty, true);
  assert.equal(parseOrderSearch(undefined).empty, true);
  assert.equal(adminSortOf('o.id; drop table orders'), 'newest');
  assert.equal(adminSortOf('total_desc'), 'total_desc');
  assert.equal(adminStatusFilterOf('constructor'), 'all');
  assert.equal(adminStatusFilterOf('needs_review'), 'needs_review');
  assert.equal(parseDay('2026-02-30x'), null);
  assert.equal(parseDay('2026-02-03'), '2026-02-03');
  assert.equal(parseDay(undefined), null);
});
