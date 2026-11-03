/**
 * The order events that can send an SMS, with the variables a template may use. The admin saves, for each event, a switch and
 * the provider's template code; the variables are passed to the provider in the order listed here (Kavenegar tokens
 * token, token2, token3; Ippanel params by name).
 */
export type SmsEventKey =
  | 'order_placed'
  | 'payment_ok'
  | 'needs_review'
  | 'shipped'
  | 'canceled'
  | 'topup_ok'
  | 'withdrawal_requested'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'commission_paid';
export type SmsVariable = 'order_no' | 'total' | 'tracking';

export const SMS_EVENTS: ReadonlyArray<{ key: SmsEventKey; label: string; vars: readonly SmsVariable[] }> = [
  { key: 'order_placed', label: 'ثبت سفارش', vars: ['order_no', 'total'] },
  { key: 'payment_ok', label: 'پرداخت موفق', vars: ['order_no', 'total'] },
  { key: 'needs_review', label: 'نیاز به بررسی', vars: ['order_no'] },
  { key: 'shipped', label: 'ارسال شد (با کد رهگیری)', vars: ['order_no', 'tracking'] },
  { key: 'canceled', label: 'لغو سفارش / بازگشت وجه', vars: ['order_no', 'total'] },
  { key: 'topup_ok', label: 'شارژ موفق کیف پول', vars: ['total'] },
  { key: 'withdrawal_requested', label: 'ثبت درخواست برداشت', vars: ['total'] },
  { key: 'withdrawal_paid', label: 'پرداخت برداشت (با کد پیگیری)', vars: ['total', 'tracking'] },
  { key: 'withdrawal_rejected', label: 'رد درخواست برداشت', vars: ['total'] },
  { key: 'commission_paid', label: 'واریز پورسانت به کیف پول', vars: ['total'] },
];

export const VARIABLE_LABEL: Record<SmsVariable, string> = {
  order_no: 'شماره سفارش',
  total: 'مبلغ (تومان)',
  tracking: 'کد رهگیری',
};

/** Only the event's own variables, as strings, in the event's order; anything else is dropped. */
export function paramsFor(
  event: SmsEventKey,
  values: Partial<Record<SmsVariable, string | number>>,
): Record<string, string> {
  const e = SMS_EVENTS.find((x) => x.key === event);
  if (!e) throw new Error(`unknown sms event ${event}`);
  const out: Record<string, string> = {};
  for (const v of e.vars) out[v] = String(values[v] ?? '');
  return out;
}
