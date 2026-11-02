/**
 * The customer's timeline of an order, from order_events. Only events that mean something to a customer are shown, in Persian;
 * everything else (retries, alerts, SMS bookkeeping, operator-side notes) is left out. No event data is ever shown as it is.
 */
export type TimelineEvent = { kind: string; data: unknown; created_at: Date };
export type TimelineStep = { key: string; label: string; at: Date; tone: 'ok' | 'warn' | 'bad' | 'info' };

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

export function timelineOf(events: readonly TimelineEvent[], createdAt: Date): TimelineStep[] {
  const out: TimelineStep[] = [{ key: 'created', label: 'سفارش ثبت شد', at: createdAt, tone: 'ok' }];
  events.forEach((e, i) => {
    let step: { label: string; tone: TimelineStep['tone'] } | undefined;
    if (e.kind === 'status') {
      const to = (e.data as { to?: unknown } | null)?.to;
      step = typeof to === 'string' ? STATUS_STEP[to] : undefined;
    } else step = SIMPLE[e.kind];
    if (step) out.push({ key: `${e.kind}-${i}`, label: step.label, at: e.created_at, tone: step.tone });
  });
  return out;
}
