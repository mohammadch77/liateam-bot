// Task G as pure rules: when a commission may be paid into the wallet (automatic vs manual, the hold, the order's state, a paid or
// cancelled one), the idempotency key, the twelve Persian months of the report, the CSV, and what the network list may show about a
// person. The database side (the paid-needs-a-wallet-row guard, one credit per commission) is in orders-db.test.mjs; the whole flow in
// affiliate-panel.e2e.mjs. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionPayoutKey, payoutDecision, type PayoutInput } from '../../src/lib/commission/payout.ts';
import {
  commissionsCsv,
  maskedPhone,
  monthlyTotals,
  networkName,
  persianYearMonth,
} from '../../src/lib/affiliate/report.ts';

const NOW = new Date('2026-03-01T10:00:00Z');
const base: PayoutInput = {
  status: 'pending',
  manualApproval: false,
  releaseAt: new Date('2026-02-20T00:00:00Z'),
  orderStatus: 'sent',
  amount: 5000,
  now: NOW,
  by: 'auto',
};

test('an automatic commission is paid once its order is sent and its hold has passed', () => {
  assert.equal(payoutDecision(base), 'pay');
  assert.equal(payoutDecision({ ...base, releaseAt: NOW }), 'pay'); // exactly due
});

test('before the hold ends the worker waits; without a release date (order not sent yet) it waits too', () => {
  assert.equal(payoutDecision({ ...base, releaseAt: new Date('2026-03-05T00:00:00Z') }), 'wait_hold');
  assert.equal(payoutDecision({ ...base, releaseAt: null }), 'wait_hold');
});

test('a manual-approval commission is never paid by the worker, only by an admin (and the hold does not stop the admin)', () => {
  assert.equal(payoutDecision({ ...base, manualApproval: true }), 'wait_manual');
  assert.equal(payoutDecision({ ...base, manualApproval: true, by: 'admin' }), 'pay');
  assert.equal(payoutDecision({ ...base, releaseAt: new Date('2026-04-01T00:00:00Z'), by: 'admin' }), 'pay'); // earlier than release_at
});

test('nothing is paid for an order that is not sent (cancelled, refunded, still in progress), by anyone', () => {
  for (const orderStatus of ['canceled', 'refunded', 'queued', 'placing', 'awaiting_payment', 'supplier_paid', 'needs_review'])
    for (const by of ['auto', 'admin'] as const)
      assert.equal(payoutDecision({ ...base, orderStatus, by }), 'order_not_sent', `${orderStatus}/${by}`);
});

test('a paid commission stays paid (no clawback, no second credit); a cancelled one earns nothing; a zero amount is skipped', () => {
  assert.equal(payoutDecision({ ...base, status: 'paid' }), 'already_paid');
  assert.equal(payoutDecision({ ...base, status: 'paid', by: 'admin' }), 'already_paid');
  assert.equal(payoutDecision({ ...base, status: 'cancelled' }), 'cancelled');
  assert.equal(payoutDecision({ ...base, status: 'approved' }), 'not_pending');
  assert.equal(payoutDecision({ ...base, amount: 0 }), 'no_amount');
  assert.equal(payoutDecision({ ...base, amount: 1.5 }), 'no_amount');
});

test('the ledger key is one per commission (what makes two ticks credit once) and fits the ledger rule', () => {
  assert.equal(commissionPayoutKey('42'), 'commission:42');
  assert.notEqual(commissionPayoutKey('42'), commissionPayoutKey('43'));
  assert.ok(commissionPayoutKey('1').length >= 8);
});

test('two workers racing for the same commission: the one that finds it already paid does nothing', () => {
  // the transaction locks the row, so the second sees the first one's result; the decision for that state is «already paid»
  const afterFirst: PayoutInput = { ...base, status: 'paid' };
  assert.equal(payoutDecision(afterFirst), 'already_paid');
});

test('the Persian month of a day, on the Tehran calendar', () => {
  assert.deepEqual(persianYearMonth(new Date('2026-03-21T12:00:00Z')), { y: 1405, m: 1 }); // 1 Farvardin 1405
  assert.deepEqual(persianYearMonth(new Date('2026-03-20T12:00:00Z')), { y: 1404, m: 12 });
});

test('the monthly report has exactly twelve Persian months, oldest first, the current one last, zeros where nothing happened', () => {
  const months = monthlyTotals(
    [
      { day: '2026-03-05', total: 1000, paid: 400 }, // Esfand 1404
      { day: '2026-03-18', total: 500, paid: 0 }, // Esfand 1404
      { day: '2026-03-25', total: 700, paid: 700 }, // Farvardin 1405
      { day: '2024-01-01', total: 999, paid: 999 }, // outside the window: dropped
    ],
    new Date('2026-04-10T10:00:00Z'), // Farvardin 1405
  );
  assert.equal(months.length, 12);
  assert.equal(months.at(-1)?.key, '1405-01');
  assert.equal(months.at(-2)?.key, '1404-12');
  assert.equal(months[0]?.key, '1404-02');
  assert.deepEqual([months.at(-2)?.total, months.at(-2)?.paid], [1500, 400]);
  assert.deepEqual([months.at(-1)?.total, months.at(-1)?.paid], [700, 700]);
  assert.equal(months.reduce((a, m) => a + m.total, 0), 2200); // nothing outside the window leaked in
  assert.equal(months.filter((m) => m.total === 0).length, 10);
  assert.match(months.at(-1)!.label, /^فروردین /);
});

test('the report rolls over a Persian year boundary', () => {
  const m = monthlyTotals([], new Date('2026-03-25T10:00:00Z'), 3);
  assert.deepEqual(m.map((x) => x.key), ['1404-11', '1404-12', '1405-01']);
});

test('the network list shows a first name or a neutral word, and the last four digits only', () => {
  assert.equal(networkName('Sara Ahmadi'), 'Sara');
  assert.equal(networkName('  علی   رضایی '), 'علی');
  assert.equal(networkName(null), 'کاربر');
  assert.equal(networkName(''), 'کاربر');
  assert.equal(networkName('x'.repeat(80)).length, 30);
  assert.equal(maskedPhone('1234'), '••••1234');
  assert.ok(!maskedPhone('09123456789').includes('0912')); // anything but four digits is not shown
});

test('the CSV: a BOM, a fixed header, one line per commission, dates on the Tehran calendar; only numbers, words and dates', () => {
  const csv = commissionsCsv([
    {
      id: '7',
      level: 2,
      status: 'paid',
      base_amount: 100000,
      amount: 2000,
      created_at: new Date('2026-03-01T10:00:00Z'),
      release_at: new Date('2026-03-08T10:00:00Z'),
      paid_at: new Date('2026-03-09T10:00:00Z'),
    },
    {
      id: '8',
      level: 1,
      status: 'pending',
      base_amount: 5,
      amount: 1,
      created_at: new Date('2026-03-01T23:30:00Z'), // after 00:00 Tehran: the next day
      release_at: null,
      paid_at: null,
    },
  ]);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(lines[0], 'id,created,level,status,base_amount_toman,commission_toman,release_date,paid_date');
  assert.equal(lines[1], '7,2026-03-01,2,paid,100000,2000,2026-03-08,2026-03-09');
  assert.equal(lines[2], '8,2026-03-02,1,pending,5,1,,');
  for (const l of lines.slice(1)) assert.ok(!/^[=+\-@]/.test(l.split(',')[0]!), 'no formula start');
});
