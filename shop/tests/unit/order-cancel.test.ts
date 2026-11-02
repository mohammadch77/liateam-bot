// A customer cancelling or editing an order, as pure rules: which statuses allow what, what returns to the wallet, the
// timeline the customer sees, and the status chips. The money, the lock and the bot happen in order-cancel.service (e2e and
// orders-db.test.mjs). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_STATUSES, canMove, type OrderStatus } from '../../src/lib/orders/status.ts';
import {
  CANCEL_MSG,
  cancelPlanOf,
  cancelRefundKey,
  canEditOrder,
  refundAmountOf,
} from '../../src/lib/orders/cancel.ts';
import { ORDER_FILTERS, ORDER_STATUS_LABEL, orderFilterOf } from '../../src/lib/orders/filters.ts';
import { timelineOf } from '../../src/lib/orders/timeline.ts';

const plans: Record<OrderStatus, string> = {
  pending_payment: 'simple',
  queued: 'refund',
  needs_review: 'refund',
  placing: 'request',
  awaiting_payment: 'request',
  supplier_paid: 'none',
  sent: 'none',
  refunded: 'none',
  canceled: 'none',
};

test('every status has exactly one plan: simple / refund before the operator pays at Liateam, request while placing, none after', () => {
  for (const s of ORDER_STATUSES) assert.equal(cancelPlanOf(s), plans[s], s);
});

test('an immediate cancel always lands on a move the status machine allows (the database enforces the same table)', () => {
  for (const s of ORDER_STATUSES)
    if (['simple', 'refund'].includes(cancelPlanOf(s))) assert.ok(canMove(s, 'canceled'), `${s} -> canceled`);
});

test('editing is allowed only where the cancel is immediate; a request or a late order cannot be edited', () => {
  const editable = ORDER_STATUSES.filter(canEditOrder);
  assert.deepEqual([...editable].sort(), ['needs_review', 'pending_payment', 'queued']);
});

test('the wallet is credited the whole payment for a paid order cancelled at once, and nothing otherwise', () => {
  assert.equal(refundAmountOf('queued', 237_900), 237_900);
  assert.equal(refundAmountOf('needs_review', 237_900), 237_900);
  for (const s of ORDER_STATUSES.filter((x) => x !== 'queued' && x !== 'needs_review'))
    assert.equal(refundAmountOf(s, 237_900), 0, s);
});

test('the refund has one idempotency key per order, so a second click, a refresh or a second tab credits once', () => {
  assert.equal(cancelRefundKey('42'), 'order-cancel-refund:42');
  assert.notEqual(cancelRefundKey('42'), cancelRefundKey('43'));
  assert.ok(cancelRefundKey('1').length >= 16); // the ledger's key-length rule
});

test('messages never promise a refund the path does not make', () => {
  assert.match(CANCEL_MSG.canceledRefund, /کیف پول/);
  assert.doesNotMatch(CANCEL_MSG.canceled, /برگشت/);
  assert.match(CANCEL_MSG.requested, /تأیید اپراتور/);
});

test('the timeline shows what a customer cares about, in order, and hides operator and bookkeeping events', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
  const steps = timelineOf(
    [
      { kind: 'payment_started', data: {}, created_at: at(1) },
      { kind: 'paid', data: {}, created_at: at(2) },
      { kind: 'bot_create_requested', data: { jobId: 5 }, created_at: at(3) },
      { kind: 'bot_linked', data: { botOrderId: 9 }, created_at: at(3) },
      { kind: 'stuck_alert', data: {}, created_at: at(4) },
      { kind: 'sms_payment_ok', data: {}, created_at: at(4) },
      { kind: 'status', data: { from: 'queued', to: 'awaiting_payment' }, created_at: at(5) },
      { kind: 'status', data: { from: 'awaiting_payment', to: 'sent' }, created_at: at(6) },
    ],
    at(0),
  );
  assert.deepEqual(
    steps.map((s) => s.label),
    [
      'سفارش ثبت شد',
      'پرداخت انجام شد',
      'در صف ثبت قرار گرفت',
      'ثبت‌شده نزد تأمین‌کننده؛ در انتظار تسویه',
      'سفارش ارسال شد',
    ],
  );
  assert.ok(steps.every((s, i) => i === 0 || s.at >= steps[i - 1]!.at));
});

test('the timeline never prints event data (no job ids, amounts or reasons)', () => {
  const steps = timelineOf(
    [{ kind: 'cancel_requested', data: { status: 'placing', secret: 'x' }, created_at: new Date() }],
    new Date(),
  );
  assert.ok(steps.every((s) => !JSON.stringify(s).includes('secret')));
  assert.equal(steps[1]?.tone, 'warn');
});

test('status filters: unknown values fall back to all; every status has a label and sits in a chip', () => {
  assert.equal(orderFilterOf('active'), 'active');
  assert.equal(orderFilterOf('nope'), 'all');
  assert.equal(orderFilterOf(undefined), 'all');
  assert.equal(orderFilterOf(['sent']), 'all');
  const covered = new Set(
    Object.values(ORDER_FILTERS).flatMap((f) => (f.statuses === null ? [] : [...f.statuses])),
  );
  for (const s of ORDER_STATUSES) {
    assert.ok(ORDER_STATUS_LABEL[s], `${s} has a label`);
    assert.ok(covered.has(s), `${s} is in a filter`);
  }
});

test('the timeline is one list in time order: creation is not pinned on top, ties go by event id, the end is marked final', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 8, m));
  const steps = timelineOf(
    [
      { id: '9', kind: 'canceled_by_customer', data: { refunded: 3175900 }, created_at: at(120) },
      { id: '3', kind: 'paid', data: {}, created_at: at(5) },
      { id: '5', kind: 'bot_linked', data: {}, created_at: at(5) },
      { id: '4', kind: 'waiting_for_placement', data: {}, created_at: at(5) },
    ],
    at(60), // created AFTER the payment events (clocks differ): it must not stay on top
  );
  assert.deepEqual(
    steps.map((s) => s.label),
    [
      'پرداخت انجام شد',
      'در صف ثبت (نوبت ثبت نزد تأمین‌کننده)',
      'در صف ثبت قرار گرفت',
      'سفارش ثبت شد',
      'سفارش به درخواست شما لغو شد',
    ],
  );
  assert.ok(steps.every((s, i) => i === 0 || s.at >= steps[i - 1]!.at));
  assert.equal(steps.at(-1)?.final, true);
  assert.equal(steps.filter((s) => s.final).length, 1);
});

test('the cancel step carries the refund from its own data, and nothing when nothing was returned', () => {
  const t = new Date();
  const refunded = timelineOf([{ id: '1', kind: 'canceled_by_customer', data: { refunded: 500000 }, created_at: t }], t);
  assert.equal(refunded.at(-1)?.note, 500000);
  for (const data of [{ refunded: 0 }, {}, null, { refunded: 'x' }]) {
    const s = timelineOf([{ id: '1', kind: 'canceled_by_customer', data, created_at: t }], t);
    assert.equal(s.at(-1)?.note, undefined);
  }
  const notFinal = timelineOf([{ id: '1', kind: 'paid', data: {}, created_at: t }], t);
  assert.equal(notFinal.some((s) => s.final), false);
});
