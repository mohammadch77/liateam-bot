/**
 * When may a commission be paid into the affiliate's wallet? Pure (no database, no clock but the one passed in).
 *
 *  - Only a PENDING commission is paid; a paid one is final (never taken back: no clawback), a cancelled one earns nothing.
 *  - The order must be `sent`: a commission of an order not sent (or cancelled / refunded since) is never paid.
 *  - Automatic: the order's hold has passed (release_at, set when the order was sent, is not in the future).
 *  - A manual-approval commission is never paid by the tick; only an admin's approval pays it (at any time once the order is sent,
 *    the hold does not stop an admin).
 */
export type PayoutInput = {
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  manualApproval: boolean;
  releaseAt: Date | null;
  orderStatus: string;
  amount: number;
  now: Date;
  /** who asks: the worker, or an admin pressing «تأیید» */
  by: 'auto' | 'admin';
};

export type PayoutDecision =
  | 'pay'
  | 'already_paid'
  | 'cancelled'
  | 'not_pending'
  | 'order_not_sent'
  | 'wait_hold'
  | 'wait_manual'
  | 'no_amount';

export function payoutDecision(i: PayoutInput): PayoutDecision {
  if (i.status === 'paid') return 'already_paid';
  if (i.status === 'cancelled') return 'cancelled';
  if (i.status !== 'pending') return 'not_pending';
  if (i.orderStatus !== 'sent') return 'order_not_sent';
  if (!Number.isSafeInteger(i.amount) || i.amount <= 0) return 'no_amount';
  if (i.by === 'auto') {
    if (i.manualApproval) return 'wait_manual';
    if (i.releaseAt === null || i.releaseAt.getTime() > i.now.getTime()) return 'wait_hold';
  }
  return 'pay';
}

/** the ledger key of a commission's payout: one per commission, so a repeat (a second tick, a double click) credits once */
export const commissionPayoutKey = (commissionId: string): string => `commission:${commissionId}`;
