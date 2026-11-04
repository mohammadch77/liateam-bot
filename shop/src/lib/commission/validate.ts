import { toLatinDigits } from '../settings/registry.ts';
import type { CommissionRule, RuleScope } from './engine.ts';

/**
 * The admin's rule form -> a typed rule (pure). Nothing has a default: every number must be typed by the admin, because the
 * client has not decided the policy. Errors are Persian messages.
 */
export type RuleInput = Omit<CommissionRule, 'id' | 'validFrom' | 'validTo'> & {
  validFrom: Date | null;
  validTo: Date | null;
};
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type FormLike = { get(name: string): unknown };
const str = (f: FormLike, n: string) => (typeof f.get(n) === 'string' ? (f.get(n) as string).trim() : '');
const int = (s: string): number | null => {
  const t = toLatinDigits(s);
  return /^\d{1,12}$/.test(t) ? Number(t) : null;
};

/** One level only: the buyer's own referrer. The engine can still weigh a longer chain; the form and the checks accept 1. */
export const MAX_LEVEL = 1;

export function parseScope(type: string, idRaw: string): Parsed<RuleScope> {
  if (type === 'all') return { ok: true, value: { type: 'all' } };
  if (type !== 'category' && type !== 'brand' && type !== 'product')
    return { ok: false, error: 'محدوده نامعتبر است.' };
  const id = int(idRaw);
  if (id === null || id <= 0) return { ok: false, error: 'شناسه‌ی محدوده را (عدد) وارد کنید.' };
  return { ok: true, value: { type, id } };
}

const date = (s: string): Date | null | undefined => {
  if (!s) return null;
  const d = new Date(`${toLatinDigits(s)}T00:00:00+03:30`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export function parseRuleForm(f: FormLike): Parsed<RuleInput> {
  const name = str(f, 'name');
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'نام قاعده باید ۲ تا ۸۰ نویسه باشد.' };
  const scope = parseScope(str(f, 'scope'), str(f, 'scopeId'));
  if (!scope.ok) return scope;
  const levelRaw = str(f, 'level');
  const level = levelRaw === '' ? 1 : int(levelRaw);
  if (level === null || level < 1 || level > MAX_LEVEL) return { ok: false, error: 'پورسانت فقط برای معرف مستقیم است (سطح ۱).' };
  const kind = str(f, 'kind');
  if (kind !== 'percent' && kind !== 'fixed')
    return { ok: false, error: 'نوع پورسانت (درصد یا مبلغ ثابت) را انتخاب کنید.' };
  const valueRaw = toLatinDigits(str(f, 'value')).replace('٫', '.');
  let value: number;
  if (kind === 'percent') {
    if (!/^\d{1,3}(\.\d{1,4})?$/.test(valueRaw))
      return { ok: false, error: 'درصد را با حداکثر ۴ رقم اعشار وارد کنید.' };
    value = Number(valueRaw);
    if (value <= 0 || value > 100) return { ok: false, error: 'درصد باید بیشتر از ۰ و حداکثر ۱۰۰ باشد.' };
  } else {
    const n = int(valueRaw);
    if (n === null || n <= 0) return { ok: false, error: 'مبلغ ثابت را به تومان (عدد صحیح مثبت) وارد کنید.' };
    value = n;
  }
  const minOrderTotal = int(str(f, 'minOrderTotal'));
  if (minOrderTotal === null)
    return { ok: false, error: 'حداقل سفارش را به تومان وارد کنید (۰ = بدون حداقل).' };
  const capRaw = str(f, 'maxPerOrder');
  const maxPerOrder = capRaw === '' ? null : int(capRaw);
  if (capRaw !== '' && (maxPerOrder === null || maxPerOrder <= 0))
    return { ok: false, error: 'سقف هر سفارش باید عدد مثبت باشد (خالی = بدون سقف).' };
  const holdDays = int(str(f, 'holdDays'));
  if (holdDays === null || holdDays > 365)
    return { ok: false, error: 'مدت نگهداری را به روز (۰ تا ۳۶۵) وارد کنید.' };
  const validFrom = date(str(f, 'validFrom'));
  const validTo = date(str(f, 'validTo'));
  if (validFrom === undefined || validTo === undefined)
    return { ok: false, error: 'تاریخ را به شکل 2025-01-31 وارد کنید.' };
  if (validFrom && validTo && validTo <= validFrom)
    return { ok: false, error: 'پایان اعتبار باید بعد از شروع باشد.' };
  return {
    ok: true,
    value: {
      name,
      scope: scope.value,
      level,
      kind,
      value,
      minOrderTotal,
      maxPerOrder,
      holdDays,
      manualApproval: str(f, 'manualApproval') === '1',
      active: str(f, 'active') === '1',
      validFrom,
      validTo,
    },
  };
}
