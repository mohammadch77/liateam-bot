import type { OrderStatus } from './status';

/**
 * When may a customer cancel (or edit) an order, and what happens. The rule of the business: until the operator makes the
 * final payment at Liateam, and not after. Pure, so the page (which buttons to show) and the service (what to allow) read the
 * same table.
 *
 *   simple   pending_payment                       nothing was paid: just cancelled
 *   refund   queued, needs_review                  paid, not placed at Liateam: cancelled now, the whole payment to the wallet
 *   request  placing, awaiting_payment             being placed / placed, not paid there: a request an operator confirms
 *   none     supplier_paid, sent, final statuses   too late
 */
export type CancelPlan = 'simple' | 'refund' | 'request' | 'none';

export const cancelPlanOf = (status: OrderStatus): CancelPlan => {
  switch (status) {
    case 'pending_payment':
      return 'simple';
    case 'queued':
    case 'needs_review':
      return 'refund';
    case 'placing':
    case 'awaiting_payment':
      return 'request';
    default:
      return 'none';
  }
};

/** editing = cancelling with the full refund and a refilled cart, so only where the cancel is immediate */
export const canEditOrder = (status: OrderStatus): boolean => {
  const p = cancelPlanOf(status);
  return p === 'simple' || p === 'refund';
};

/** the wallet is credited only for a paid order cancelled at once */
export const refundAmountOf = (status: OrderStatus, totalPayable: number): number =>
  cancelPlanOf(status) === 'refund' ? totalPayable : 0;

export const cancelRefundKey = (orderId: string) => `order-cancel-refund:${orderId}`;

/** what the customer is told after a cancel / request, by what happened */
export const CANCEL_MSG = {
  off: 'لغو و ویرایش سفارش توسط مشتری فعلاً غیرفعال است. با پشتیبانی تماس بگیرید.',
  tooLate: 'این سفارش دیگر قابل لغو نیست.',
  busy: 'سفارش همین لحظه در حال پیشروی است. چند ثانیه بعد دوباره تلاش کنید.',
  moved: 'وضعیت سفارش همین الان تغییر کرد و دیگر در این مرحله نیست. صفحه را تازه کنید.',
  canceled: 'سفارش لغو شد.',
  canceledRefund: 'سفارش لغو شد و مبلغ به کیف پول شما برگشت.',
  requested: 'درخواست لغو ثبت شد و پس از تأیید اپراتور مبلغ به کیف پول برمی‌گردد.',
  requestedAgain: 'درخواست لغو این سفارش قبلاً ثبت شده و در انتظار تأیید اپراتور است.',
  already: 'این سفارش قبلاً لغو شده است.',
} as const;
