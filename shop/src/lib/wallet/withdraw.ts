/**
 * The wallet's pure rules: how much may be withdrawn, whether a withdrawal request or a top-up is acceptable, and how a
 * withdrawal may change status (the database enforces the same moves). Money is whole TOMAN. No database here.
 */
export type WithdrawalStatus = 'pending' | 'paid' | 'rejected' | 'canceled';

const MOVES: Readonly<Record<WithdrawalStatus, readonly WithdrawalStatus[]>> = {
  pending: ['paid', 'rejected', 'canceled'],
  paid: [],
  rejected: [],
  canceled: [],
};
export const canMoveWithdrawal = (from: WithdrawalStatus, to: WithdrawalStatus): boolean =>
  MOVES[from].includes(to);

export type WithdrawSource = 'commission' | 'balance';

/**
 * The most a user may withdraw now.
 *  - commission (default): commission credited to the wallet, minus what was already withdrawn (pending and paid ones;
 *    rejected / canceled were returned), and never more than the balance now.
 *  - balance: the whole balance.
 */
export function withdrawable(i: {
  source: WithdrawSource;
  balance: number;
  commissionIn: number;
  withdrawnActive: number;
}): number {
  const balance = Math.max(0, Math.trunc(i.balance));
  if (i.source === 'balance') return balance;
  return Math.max(0, Math.min(balance, Math.trunc(i.commissionIn) - Math.trunc(i.withdrawnActive)));
}

export type WithdrawCheck = { ok: true } | { ok: false; reason: 'amount' | 'min' | 'max' | 'over' | 'pending' };

export function checkWithdrawal(i: {
  amount: number;
  min: number;
  max: number;
  withdrawable: number;
  hasPending: boolean;
  singlePending: boolean;
}): WithdrawCheck {
  if (!Number.isSafeInteger(i.amount) || i.amount <= 0) return { ok: false, reason: 'amount' };
  if (i.singlePending && i.hasPending) return { ok: false, reason: 'pending' };
  if (i.amount < i.min) return { ok: false, reason: 'min' };
  if (i.amount > Math.max(i.min, i.max)) return { ok: false, reason: 'max' };
  if (i.amount > i.withdrawable) return { ok: false, reason: 'over' };
  return { ok: true };
}

/** the top-up window; if the admin saved a maximum below the minimum, the minimum wins */
export function checkTopup(amount: number, min: number, max: number): 'ok' | 'amount' | 'min' | 'max' {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'amount';
  if (amount < min) return 'min';
  if (amount > Math.max(min, max)) return 'max';
  return 'ok';
}

/** quick-pick amounts inside the window */
export function presetAmounts(min: number, max: number): number[] {
  const hi = Math.max(min, max);
  return [50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000].filter((a) => a >= min && a <= hi);
}
