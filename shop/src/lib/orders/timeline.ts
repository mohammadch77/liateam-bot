/**
 * The customer's timeline of an order, from order_events. Only events that mean something to a customer are shown, in Persian;
 * everything else (retries, alerts, SMS bookkeeping, operator-side notes) is left out. No event data is ever shown as it is.
 */
export type TimelineEvent = { id?: string; kind: string; data: unknown; created_at: Date };
export type TimelineStep = {
  key: string;
  label: string;
  at: Date;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  /** a line under the label (e.g. the refund of a cancel); absent when there is nothing to say */
  note?: number;
  /** the last step when it ends the order (cancelled, sent): shown strongest */
  final?: boolean;
};

const STATUS_STEP: Record<string, { label: string; tone: TimelineStep['tone'] } | undefined> = {
  placing: { label: 'در حال ثبت نزد تأمین‌کننده', tone: 'info' },
  awaiting_payment: { label: 'ثبت‌شده نزد تأمین‌کننده؛ در انتظار تسویه', tone: 'info' },
  supplier_paid: { label: 'تأمین‌کننده تسویه شد؛ در حال آماده‌سازی', tone: 'ok' },
  sent: { label: 'سفارش ارسال شد', tone: 'ok' },
  needs_review: { label: 'در حال بررسی توسط پشتیبانی', tone: 'warn' },
  canceled: { label: 'سفارش لغو شد', tone: 'bad' },
  refunded: { label: 'مبلغ سفارش بازگردانده شد', tone: 'bad' },
};

const SIMPLE: Record<string, { label: string; tone: TimelineStep['tone'] } | undefined> = {
  paid: { label: 'پرداخت انجام شد', tone: 'ok' },
  waiting_for_placement: { label: 'در صف ثبت (نوبت ثبت نزد تأمین‌کننده)', tone: 'info' },
  bot_linked: { label: 'در صف ثبت قرار گرفت', tone: 'info' },
  payment_canceled: { label: 'پرداخت انصراف داده شد', tone: 'warn' },
  payment_failed: { label: 'پرداخت ناموفق بود', tone: 'warn' },
  expired: { label: 'مهلت پرداخت تمام شد؛ سفارش لغو شد', tone: 'bad' },
  canceled_by_customer: { label: 'سفارش به درخواست شما لغو شد', tone: 'bad' },
  cancel_requested: { label: 'درخواست لغو ثبت شد؛ منتظر تأیید اپراتور', tone: 'warn' },
};

const FINAL = new Set(['canceled_by_customer', 'status:canceled', 'status:sent', 'status:refunded']);

/**
 * One list, oldest first: every step (the order's creation included) is sorted by its time, ties by event id (creation first).
 * The last step is marked `final` when it ends the order. `note` is the toman returned to the wallet by a cancel (from the
 * event's own data), only when something was returned.
 */
export function timelineOf(events: readonly TimelineEvent[], createdAt: Date): TimelineStep[] {
  const rows: Array<{ step: TimelineStep; id: number; end: boolean }> = [
    { step: { key: 'created', label: 'سفارش ثبت شد', at: createdAt, tone: 'ok' }, id: -1, end: false },
  ];
  events.forEach((e, i) => {
    let step: { label: string; tone: TimelineStep['tone'] } | undefined;
    let end = FINAL.has(e.kind);
    if (e.kind === 'status') {
      const to = (e.data as { to?: unknown } | null)?.to;
      step = typeof to === 'string' ? STATUS_STEP[to] : undefined;
      end = typeof to === 'string' && FINAL.has(`status:${to}`);
    } else step = SIMPLE[e.kind];
    if (!step) return;
    const out: TimelineStep = { key: `${e.kind}-${e.id ?? i}`, label: step.label, at: e.created_at, tone: step.tone };
    if (e.kind === 'canceled_by_customer') {
      const refunded = Number((e.data as { refunded?: unknown } | null)?.refunded);
      if (Number.isFinite(refunded) && refunded > 0) out.note = refunded;
    }
    rows.push({ step: out, id: Number.isFinite(Number(e.id)) ? Number(e.id) : i, end });
  });
  rows.sort((x, y) => x.step.at.getTime() - y.step.at.getTime() || x.id - y.id);
  const last = rows[rows.length - 1];
  if (last && last.end) last.step.final = true;
  return rows.map((r) => r.step);
}
