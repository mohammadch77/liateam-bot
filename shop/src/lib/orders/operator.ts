import { toLatinDigits } from '../phone.mjs';
import type { OrderStatus } from './status.ts';

/**
 * What the operator (admin) may do with an order, decided from the order's CURRENT status and what is known about it. Pure, so
 * the page (which buttons) and the service (what to allow, again, under the lock) read the same table. Money moves only to the
 * customer's wallet; a refund to a bank account is never automatic.
 *
 *   place            queued                           «ثبت در لیاتیم» (the same call the automatic placing makes)
 *   recheck          needs_review (with a bot order)  ask the bot to check the basket again
 *   continue_review  needs_review, the live total did not rise and nothing is missing: place at the new total, the saving to the wallet
 *   cancel           queued, needs_review, awaiting_payment: cancel + the whole payment to the wallet
 *   approve_cancel   awaiting_payment with an open customer request: the same cancel, recorded as the answer to the request
 *   reject_cancel    an open customer request (placing, awaiting_payment): refused with a reason, the customer is told
 *   mark_paid        awaiting_payment                 the payment at Liateam was made: supplier_paid, with a reference
 *   ship             supplier_paid                    the postal tracking code, sent
 *   manual_return    supplier_paid, sent              a note and an event only, no money moves by itself
 *   note             any status
 */
export type OperatorAction =
  | 'place'
  | 'recheck'
  | 'continue_review'
  | 'cancel'
  | 'approve_cancel'
  | 'reject_cancel'
  | 'mark_paid'
  | 'ship'
  | 'manual_return'
  | 'note';

export type ReviewKind = 'price_up' | 'price_down' | 'price_same' | 'unavailable' | 'unknown';

export type OperatorContext = {
  status: OrderStatus;
  /** the customer asked to cancel and nobody has answered yet */
  openCancelRequest: boolean;
  hasBotOrder: boolean;
  /** only for needs_review */
  reviewKind: ReviewKind | null;
};

export function allowedActions(c: OperatorContext): OperatorAction[] {
  const out: OperatorAction[] = ['note'];
  const s = c.status;
  if (s === 'queued' && c.hasBotOrder) out.push('place');
  if (s === 'needs_review' && c.hasBotOrder) out.push('recheck');
  if (s === 'needs_review' && c.hasBotOrder && (c.reviewKind === 'price_down' || c.reviewKind === 'price_same'))
    out.push('continue_review');
  if (s === 'queued' || s === 'needs_review' || s === 'awaiting_payment') out.push('cancel');
  if (s === 'awaiting_payment' && c.openCancelRequest) out.push('approve_cancel');
  if ((s === 'placing' || s === 'awaiting_payment') && c.openCancelRequest) out.push('reject_cancel');
  if (s === 'awaiting_payment') out.push('mark_paid');
  if (s === 'supplier_paid') out.push('ship');
  if (s === 'supplier_paid' || s === 'sent') out.push('manual_return');
  return out;
}

export const canDo = (action: OperatorAction, c: OperatorContext): boolean => allowedActions(c).includes(action);

/** Why an action is refused, in words for the operator (used when the status moved between the page and the click). */
export const REFUSAL = {
  moved: 'وضعیت سفارش همین الان تغییر کرد و این اقدام دیگر در این مرحله مجاز نیست. صفحه را تازه کنید.',
  busy: 'سفارش همین لحظه در حال پیشروی است. چند ثانیه بعد دوباره تلاش کنید.',
  noBotOrder: 'این سفارش هنوز سفارش متناظر در ربات ندارد.',
  alreadyQueued: 'درخواست ثبت این سفارش قبلاً در صف ربات است.',
  cannotContinue: 'با قیمت یا موجودی فعلی ادامه ممکن نیست؛ لغو کنید یا بررسی دوباره بخواهید.',
  botRunning: 'ربات همین الان سفارش را در لیاتیم ثبت می‌کند و لغو ممکن نیست. کمی بعد دوباره تلاش کنید.',
} as const;

/** What stopped the bot, from its own numbers: the live Liateam total against the total the customer was shown. */
export function reviewKindOf(info: {
  reason: string | null;
  live: number | null;
  expected: number | null;
  missing: number;
}): ReviewKind {
  if (info.reason === 'unavailable' || info.missing > 0) return 'unavailable';
  if (info.live === null || info.expected === null) return 'unknown';
  if (info.live > info.expected) return 'price_up';
  return info.live < info.expected ? 'price_down' : 'price_same';
}

/**
 * Toman to give back when the operator continues at a LOWER live total: the saving against what the order was priced at, minus
 * what earlier continues already gave back, never more than the order's payment and never negative.
 */
export function reviewSaving(orderLiveTotal: number | null, live: number | null, alreadyGiven: number, totalPayable: number): number {
  if (orderLiveTotal === null || live === null) return 0;
  const baseline = orderLiveTotal - alreadyGiven;
  return Math.min(Math.max(baseline - live, 0), totalPayable);
}

// ── the 20-minute payment link at Liateam ──

export type LinkState = 'none' | 'active' | 'expiring' | 'expired';
export type LinkClock = { state: LinkState; expiresAt: Date | null; msLeft: number };

/**
 * The link's life: from the moment the bot placed the order at Liateam (it issues the link then) for `ttlMinutes`; «expiring»
 * once `remindMinutes` or fewer are left. No link time or an order that is not waiting for payment = none.
 */
export function linkClock(
  issuedAt: Date | null,
  ttlMinutes: number,
  remindMinutes: number,
  now: Date,
  waiting = true,
): LinkClock {
  if (!issuedAt || !waiting) return { state: 'none', expiresAt: null, msLeft: 0 };
  const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60_000);
  const msLeft = expiresAt.getTime() - now.getTime();
  if (msLeft <= 0) return { state: 'expired', expiresAt, msLeft: 0 };
  return { state: msLeft <= remindMinutes * 60_000 ? 'expiring' : 'active', expiresAt, msLeft };
}

// ── inputs ──

/** A postal tracking code: letters, digits and dashes, 5 to 40 long (Persian / Arabic digits become Latin). Null = invalid. */
export function parseTrackingCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = toLatinDigits(raw).trim();
  return /^[A-Za-z0-9-]{5,40}$/.test(v) ? v : null;
}

/** Free text (a payment reference, a reason, a note): trimmed, no control characters, within the length. Null = invalid. */
export function parseText(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== 'string') return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) return null;
  const v = raw.replace(/\r\n/g, '\n').trim();
  return v.length >= min && v.length <= max ? v : null;
}

/** The customer asked to cancel and no answer was written after it (events oldest first). */
export function hasOpenCancelRequest(events: ReadonlyArray<{ kind: string }>): boolean {
  let open = false;
  for (const e of events) {
    if (e.kind === 'cancel_requested') open = true;
    else if (e.kind === 'cancel_request_rejected' || e.kind === 'cancel_request_approved') open = false;
  }
  return open;
}

// ── the admin list ──

export const ADMIN_STATUS_FILTERS = {
  all: { label: 'همه', statuses: null },
  action: { label: 'نیازمند اقدام', statuses: null },
  pending_payment: { label: 'در انتظار پرداخت', statuses: ['pending_payment'] },
  queued: { label: 'در صف ثبت', statuses: ['queued'] },
  placing: { label: 'در حال ثبت', statuses: ['placing'] },
  awaiting_payment: { label: 'منتظر پرداخت لیاتیم', statuses: ['awaiting_payment'] },
  supplier_paid: { label: 'تسویه‌شده', statuses: ['supplier_paid'] },
  sent: { label: 'ارسال‌شده', statuses: ['sent'] },
  needs_review: { label: 'نیاز به بررسی', statuses: ['needs_review'] },
  canceled: { label: 'لغو / بازگشت', statuses: ['canceled', 'refunded'] },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] | null }>;
export type AdminStatusFilter = keyof typeof ADMIN_STATUS_FILTERS;
export const adminStatusFilterOf = (raw: unknown): AdminStatusFilter =>
  typeof raw === 'string' && Object.hasOwn(ADMIN_STATUS_FILTERS, raw) ? (raw as AdminStatusFilter) : 'all';

export const ADMIN_SORTS = {
  newest: { label: 'جدیدترین', sql: 'o.created_at DESC, o.id DESC' },
  oldest: { label: 'قدیمی‌ترین', sql: 'o.created_at ASC, o.id ASC' },
  total_desc: { label: 'بیشترین مبلغ', sql: 'o.total_payable DESC, o.id DESC' },
  total_asc: { label: 'کمترین مبلغ', sql: 'o.total_payable ASC, o.id ASC' },
} as const;
export type AdminSort = keyof typeof ADMIN_SORTS;
export const adminSortOf = (raw: unknown): AdminSort =>
  typeof raw === 'string' && Object.hasOwn(ADMIN_SORTS, raw) ? (raw as AdminSort) : 'newest';

/**
 * What the search box means: an order number (AV-100001 or just its digits) or a mobile number (09123456789, any digits). Anything
 * else matches nothing. Returned as parameters for the repository, never as SQL.
 */
export function parseOrderSearch(raw: unknown): { number: string | null; phone: string | null; empty: boolean } {
  if (typeof raw !== 'string') return { number: null, phone: null, empty: true };
  const v = toLatinDigits(raw).trim().toUpperCase();
  if (!v) return { number: null, phone: null, empty: true };
  if (/^AV-?\d{4,12}$/.test(v)) return { number: v.replace(/^AV-?/, 'AV-'), phone: null, empty: false };
  if (/^09\d{9}$/.test(v)) return { number: null, phone: v, empty: false };
  if (/^\d{4,12}$/.test(v)) return { number: `AV-${v}`, phone: null, empty: false };
  return { number: '', phone: null, empty: false }; // not a number: finds nothing
}

/** The date box (YYYY-MM-DD) or null. */
export const parseDay = (raw: unknown): string | null =>
  typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;

export const OPERATOR_EVENT_LABEL: Record<string, string> = {
  status: 'تغییر وضعیت',
  paid: 'پرداخت مشتری',
  bot_create_requested: 'درخواست ساخت سفارش در ربات',
  bot_create_failed: 'ساخت سفارش در ربات ناموفق بود',
  bot_linked: 'سفارش در صف ربات قرار گرفت',
  waiting_for_placement: 'منتظر ثبت (ثبت خودکار انجام نشد)',
  place_requested: 'درخواست ثبت در لیاتیم',
  stuck_alert: 'هشدار: سفارش بیش از حد در صف مانده',
  stuck_sms: 'پیامک هشدار گیرکردن به اپراتور',
  payment_link_expiring: 'هشدار: مهلت لینک پرداخت لیاتیم رو به پایان است',
  cancel_requested: 'مشتری درخواست لغو داد',
  cancel_request_rejected: 'درخواست لغو رد شد',
  cancel_request_approved: 'درخواست لغو تأیید شد',
  canceled_by_customer: 'لغو توسط مشتری',
  canceled_by_admin: 'لغو توسط ادمین',
  review_rechecked: 'بررسی دوباره از ربات خواسته شد',
  review_continued: 'ادامه با قیمت جدید',
  supplier_paid_manual: 'پرداخت لیاتیم دستی ثبت شد',
  shipped_manual: 'ارسال دستی ثبت شد',
  manual_return_noted: 'بازگشت دستی یادداشت شد',
  admin_note: 'یادداشت ادمین',
  payment_failed: 'پرداخت ناموفق',
  payment_canceled: 'پرداخت انصراف داده شد',
  expired: 'مهلت پرداخت تمام شد',
};
