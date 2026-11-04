import { insideAutoPlaceHours, type AutoPlaceHours } from './settings.ts';
import { canMove, isOrderStatus, type OrderStatus } from './status.ts';

/**
 * Pure decisions of the payment flow (no database, no network): what the gateway's return may tell us, whether a paid order is
 * placed at Liateam now or waits, how the bot's status maps onto the shop's, and the tracking code shown to the customer.
 * Money never comes from here: the amount of a payment is always the order's own total in the database.
 */

/**
 * The only things read from the gateway's return: the authority (a reference) and whether the customer says OK / NOK.
 * Everything else in the query (an amount, an order number, a status of our own) is ignored. `sim` is the dev simulator's.
 */
export function parseCallbackQuery(q: Readonly<Record<string, string | string[] | undefined>>): {
  authority: string | null;
  status: 'OK' | 'NOK' | null;
  sim: string | null;
} {
  const one = (k: string) => {
    const v = q[k];
    return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? '') : '';
  };
  const authority = /^[A-Za-z0-9]{6,60}$/.test(one('Authority')) ? one('Authority') : null;
  const s = one('Status').toUpperCase();
  const sim = /^(success|failed|canceled)$/.test(one('sim')) ? one('sim') : null;
  return { authority, status: s === 'OK' || s === 'NOK' ? s : null, sim };
}

/** minutes since midnight on the Tehran wall clock */
export function tehranMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n('hour') * 60 + n('minute');
}

export type PlacementPlan = 'place_now' | 'wait_auto_off' | 'wait_hours';

/** A paid order goes to Liateam at once only when automatic placing is on and now is inside the working hours. */
export function placementPlan(
  s: { autoPlaceEnabled: boolean; autoPlaceHours: AutoPlaceHours },
  now: Date,
): PlacementPlan {
  if (!s.autoPlaceEnabled) return 'wait_auto_off';
  return insideAutoPlaceHours(s.autoPlaceHours, tehranMinutes(now)) ? 'place_now' : 'wait_hours';
}

/**
 * The steps the shop takes to follow the bot to `bot`: usually one, but the bot can move faster than the shop looks (queued ->
 * sent) and the status machine allows only single steps, so the shortest path through the working statuses is returned.
 * Empty when there is nothing to do (same status, unknown status, or no way there).
 */
export function botPath(current: OrderStatus, bot: unknown): OrderStatus[] {
  if (!isOrderStatus(bot) || bot === 'pending_payment' || bot === current) return [];
  if (canMove(current, bot)) return [bot];
  const via: OrderStatus[] = ['queued', 'placing', 'awaiting_payment', 'supplier_paid', 'needs_review'];
  const prev = new Map<OrderStatus, OrderStatus | null>([[current, null]]);
  const queue: OrderStatus[] = [current];
  const candidates: OrderStatus[] = [...via, bot];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of candidates) {
      if (prev.has(next) || !canMove(at, next)) continue;
      prev.set(next, at);
      if (next === bot) {
        const path: OrderStatus[] = [];
        for (let n: OrderStatus | null | undefined = bot; n && n !== current; n = prev.get(n))
          path.unshift(n);
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

/** A tracking code from whatever the bot stored (a string, or an object with a code under a known key). */
export function trackingCode(tracking: unknown): string {
  if (typeof tracking === 'string') return tracking.slice(0, 60);
  if (tracking && typeof tracking === 'object') {
    for (const k of ['code', 'tracking_code', 'trackingCode', 'barcode', 'post_code']) {
      const v = (tracking as Record<string, unknown>)[k];
      if (typeof v === 'string' || typeof v === 'number') return String(v).slice(0, 60);
    }
  }
  return '';
}

/** Who may start a payment: only an order still waiting for it. */
export const canStartPayment = (status: OrderStatus): boolean => status === 'pending_payment';

/** Minimum time the live check must still hold when a payment starts (the gateway visit takes a few minutes). */
export const MIN_HOLD_LEFT_MS = 2 * 60_000;

/** Is there still enough of the live check's hold to start paying? */
export const holdLeft = (expiresAt: Date | null, now: Date): boolean =>
  expiresAt !== null && expiresAt.getTime() - now.getTime() >= MIN_HOLD_LEFT_MS;

export type PayOptions = { online: boolean; walletBalance: number };
export type PayMethodId = 'gateway' | 'wallet';

/** Can this method pay `total` toman now? (UI hint only: the server checks again) */
export function methodUsable(method: PayMethodId, o: PayOptions, total: number | null): boolean {
  if (method === 'gateway') return o.online;
  return total !== null ? o.walletBalance >= total && total > 0 : o.walletBalance > 0;
}

/** The method preselected: online when it works, else the wallet when it covers the total, else online (disabled with its message). */
export function defaultMethod(o: PayOptions, total: number | null): PayMethodId {
  if (methodUsable('gateway', o, total)) return 'gateway';
  return methodUsable('wallet', o, total) ? 'wallet' : 'gateway';
}

/** The checkout's state as far as the pay button is concerned. */
export type CheckoutGate = {
  hasAddress: boolean;
  /** the live check: none yet, waiting, answered, failed */
  phase: 'idle' | 'pending' | 'ready' | 'failed';
  /** the answer allows an order (nothing missing) */
  canOrder: boolean;
  /** the hold of the answer ran out */
  expired: boolean;
  /** the answer's own reason when it does not allow an order */
  reason: string | null;
  pay: PayOptions;
  total: number | null;
  method: PayMethodId;
};

/**
 * Why the «پرداخت» button is off, in words for the customer, or null when it is on. A button is never off without a reason: the
 * first thing missing is named (address, then the check, then the payment method).
 */
export function payBlocker(g: CheckoutGate): string | null {
  if (!g.hasAddress) return 'آدرس تحویل را انتخاب کنید.';
  if (g.phase === 'idle' || g.phase === 'pending') return 'منتظر پایان بررسی قیمت و موجودی بمانید.';
  if (g.phase === 'failed') return 'بررسی قیمت و موجودی انجام نشد؛ «تلاش مجدد» را بزنید.';
  if (g.expired) return 'مهلت نگه‌داری موجودی تمام شد؛ دوباره بررسی کنید.';
  if (!g.canOrder) return g.reason ?? 'سبد را اصلاح و دوباره بررسی کنید.';
  if (methodUsable(g.method, g.pay, g.total)) return null;
  if (!g.pay.online && !methodUsable('wallet', g.pay, g.total))
    return g.pay.walletBalance > 0
      ? 'پرداخت آنلاین فعلاً در دسترس نیست و موجودی کیف پول برای این سفارش کافی نیست.'
      : 'پرداخت آنلاین فعلاً در دسترس نیست.';
  if (g.method === 'wallet') return 'موجودی کیف پول کافی نیست؛ روش پرداخت دیگری را انتخاب کنید.';
  return 'روش پرداخت را انتخاب کنید.';
}
