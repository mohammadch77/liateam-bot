import type { OrderStatus } from './status';

/** The status chips of «سفارش‌های من»: a key in the URL, a Persian label, and the statuses it covers (null = all). */
export const ORDER_FILTERS = {
  all: { label: 'همه', statuses: null },
  pending: { label: 'در انتظار پرداخت', statuses: ['pending_payment'] },
  active: {
    label: 'در جریان',
    statuses: ['queued', 'placing', 'awaiting_payment', 'supplier_paid', 'needs_review'],
  },
  sent: { label: 'ارسال‌شده', statuses: ['sent'] },
  canceled: { label: 'لغو / بازگشت', statuses: ['canceled', 'refunded'] },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] | null }>;

export type OrderFilterKey = keyof typeof ORDER_FILTERS;

export const orderFilterOf = (raw: unknown): OrderFilterKey =>
  typeof raw === 'string' && Object.hasOwn(ORDER_FILTERS, raw) ? (raw as OrderFilterKey) : 'all';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'در انتظار پرداخت',
  queued: 'پرداخت‌شده، در صف ثبت',
  placing: 'در حال ثبت',
  awaiting_payment: 'در حال ثبت نزد تأمین‌کننده',
  supplier_paid: 'در حال آماده‌سازی',
  sent: 'ارسال شد',
  needs_review: 'در حال بررسی',
  refunded: 'بازگشت وجه شد',
  canceled: 'لغو شد',
};
