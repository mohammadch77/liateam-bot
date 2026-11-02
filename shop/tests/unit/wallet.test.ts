// The wallet task as pure rules: the IBAN check, the withdrawable amount in both modes, the request and top-up limits (the
// minimum is a setting), and the withdrawal status moves. The ledger, the holds and the idempotency are in orders-db.test.mjs
// (the database) and account-wallet.e2e.mjs (the whole flow). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidIban, maskIban, normalizeIban } from '../../src/lib/wallet/iban.ts';
import {
  canMoveWithdrawal,
  checkTopup,
  checkWithdrawal,
  presetAmounts,
  withdrawable,
  type WithdrawalStatus,
} from '../../src/lib/wallet/withdraw.ts';

const GOOD = 'IR780600000000100324200001';

test('IBAN: the mod-97 check passes a good number and fails a changed digit, a wrong length or a missing prefix', () => {
  assert.equal(isValidIban(GOOD), true);
  assert.equal(isValidIban(GOOD.slice(0, -1) + '2'), false);
  assert.equal(isValidIban(GOOD + '0'), false);
  assert.equal(isValidIban(GOOD.slice(0, -1)), false);
  assert.equal(isValidIban(GOOD.slice(2)), false);
  assert.equal(isValidIban('IR78' + 'A'.repeat(22)), false);
  assert.equal(isValidIban(''), false);
});

test('IBAN: spaces, dashes, lower case and Persian / Arabic digits are accepted and normalised', () => {
  const persian = 'ir۷۸ ۰۶۰۰ ۰۰۰۰ ۰۰۱۰ ۰۳۲۴ ۲۰۰۰ ۰۱';
  assert.equal(normalizeIban(persian), GOOD);
  assert.equal(isValidIban(persian), true);
  assert.equal(isValidIban('IR78-0600-0000-0010-0324-2000-01'), true);
  const arabic = GOOD.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
  assert.equal(isValidIban(arabic), true);
});

test('IBAN: the mask shows only the last four digits', () => {
  const m = maskIban('0001');
  assert.ok(m.endsWith('0001') && m.startsWith('IR') && !m.includes('78'));
});

test('withdrawable, commission mode: commission credited minus pending and paid withdrawals, never above the balance', () => {
  const base = { source: 'commission' as const };
  assert.equal(withdrawable({ ...base, balance: 1_000_000, commissionIn: 300_000, withdrawnActive: 0 }), 300_000);
  assert.equal(withdrawable({ ...base, balance: 1_000_000, commissionIn: 300_000, withdrawnActive: 250_000 }), 50_000);
  assert.equal(withdrawable({ ...base, balance: 120_000, commissionIn: 300_000, withdrawnActive: 0 }), 120_000); // balance caps it
  assert.equal(withdrawable({ ...base, balance: 1_000_000, commissionIn: 100_000, withdrawnActive: 400_000 }), 0); // never negative
  assert.equal(withdrawable({ ...base, balance: 5_000_000, commissionIn: 0, withdrawnActive: 0 }), 0); // charged money is not withdrawable
});

test('withdrawable, balance mode: the whole balance', () => {
  assert.equal(withdrawable({ source: 'balance', balance: 777_000, commissionIn: 0, withdrawnActive: 0 }), 777_000);
  assert.equal(withdrawable({ source: 'balance', balance: -5, commissionIn: 0, withdrawnActive: 0 }), 0);
});

const ok = { min: 200_000, max: 5_000_000, withdrawable: 1_000_000, hasPending: false, singlePending: true };

test('a withdrawal request: amount, minimum (a setting), maximum, the withdrawable limit, one pending at a time', () => {
  assert.deepEqual(checkWithdrawal({ ...ok, amount: 300_000 }), { ok: true });
  assert.deepEqual(checkWithdrawal({ ...ok, amount: 199_999 }), { ok: false, reason: 'min' });
  assert.deepEqual(checkWithdrawal({ ...ok, amount: 1_000_001 }), { ok: false, reason: 'over' });
  assert.deepEqual(checkWithdrawal({ ...ok, withdrawable: 9_000_000, amount: 5_000_001 }), { ok: false, reason: 'max' });
  assert.deepEqual(checkWithdrawal({ ...ok, amount: 0 }), { ok: false, reason: 'amount' });
  assert.deepEqual(checkWithdrawal({ ...ok, amount: 1.5 }), { ok: false, reason: 'amount' });
  assert.deepEqual(checkWithdrawal({ ...ok, amount: Number.NaN }), { ok: false, reason: 'amount' });
  assert.deepEqual(checkWithdrawal({ ...ok, amount: 300_000, hasPending: true }), { ok: false, reason: 'pending' });
  assert.deepEqual(checkWithdrawal({ ...ok, amount: 300_000, hasPending: true, singlePending: false }), { ok: true });
});

test('the minimum is changeable: the same amount passes under one setting and fails under another', () => {
  assert.equal(checkWithdrawal({ ...ok, min: 100_000, amount: 150_000 }).ok, true);
  assert.equal(checkWithdrawal({ ...ok, min: 500_000, amount: 150_000 }).ok, false);
});

test('a top-up: the admin window, the minimum wins when the maximum was saved below it', () => {
  assert.equal(checkTopup(50_000, 50_000, 50_000_000), 'ok');
  assert.equal(checkTopup(49_999, 50_000, 50_000_000), 'min');
  assert.equal(checkTopup(50_000_001, 50_000, 50_000_000), 'max');
  assert.equal(checkTopup(0, 50_000, 50_000_000), 'amount');
  assert.equal(checkTopup(10.5, 50_000, 50_000_000), 'amount');
  assert.equal(checkTopup(60_000, 100_000, 10_000), 'min');
  assert.equal(checkTopup(100_000, 100_000, 10_000), 'ok');
});

test('quick amounts stay inside the window', () => {
  assert.deepEqual(presetAmounts(50_000, 500_000), [50_000, 100_000, 200_000, 500_000]);
  assert.deepEqual(presetAmounts(300_000, 1_000_000), [500_000, 1_000_000]);
});

test('a withdrawal moves only from pending, to paid / rejected / canceled; the others are final', () => {
  const all: WithdrawalStatus[] = ['pending', 'paid', 'rejected', 'canceled'];
  for (const to of ['paid', 'rejected', 'canceled'] as const) assert.equal(canMoveWithdrawal('pending', to), true);
  for (const from of ['paid', 'rejected', 'canceled'] as const)
    for (const to of all) assert.equal(canMoveWithdrawal(from, to), false, `${from}->${to}`);
  assert.equal(canMoveWithdrawal('pending', 'pending'), false);
});
