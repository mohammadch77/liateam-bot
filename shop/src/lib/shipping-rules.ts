import { toLatinDigits } from './settings/registry.ts';

/**
 * The admin's shipping form → typed, validated input (pure, no database). Delivery ranges are WORKING days; checkout shows
 * range + the «shipping.extra_days» setting (src/lib/orders/delivery.ts). A blank pair means "no range of its own".
 */
export type Range = { min: number; max: number };
export type ShippingInput = {
  label: string;
  active: boolean;
  /** the range for every province without its own; null = none entered */
  fallback: Range | null;
  /** only the provinces the form listed; null = no range of its own (the fallback applies) */
  provinces: Array<{ id: number; range: Range | null }>;
};
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_DAYS = 60;

/** '' + '' → null (cleared); a number pair → a range; anything else → an error message. */
export function parseRange(minRaw: unknown, maxRaw: unknown, where: string): Parsed<Range | null> {
  const t = (v: unknown) => (typeof v === 'string' ? toLatinDigits(v) : '');
  const [a, b] = [t(minRaw), t(maxRaw)];
  if (a === '' && b === '') return { ok: true, value: null };
  if (a === '' || b === '') return { ok: false, error: `${where}: هر دو عدد حداقل و حداکثر را وارد کنید.` };
  if (!/^\d{1,3}$/.test(a) || !/^\d{1,3}$/.test(b))
    return { ok: false, error: `${where}: فقط عدد صحیح (روز) وارد کنید.` };
  const [min, max] = [Number(a), Number(b)];
  if (min > MAX_DAYS || max > MAX_DAYS)
    return { ok: false, error: `${where}: حداکثر ${MAX_DAYS} روز مجاز است.` };
  if (max < min) return { ok: false, error: `${where}: حداکثر نباید از حداقل کمتر باشد.` };
  return { ok: true, value: { min, max } };
}

type FormLike = { get(name: string): unknown; getAll(name: string): unknown[] };

/**
 * Form fields: label, active=1, fallback.min / fallback.max, p.<id>.min / p.<id>.max for each listed province, and for the
 * bulk button (intent=bulk) bulk.min / bulk.max applied to every ticked sel=<id>. `names` maps province ids to names for
 * the error messages.
 */
export function parseShippingForm(form: FormLike, names: ReadonlyMap<number, string>): Parsed<ShippingInput> {
  const text = (n: string) => (typeof form.get(n) === 'string' ? (form.get(n) as string).trim() : '');
  const label = text('label');
  if (label.length < 2 || label.length > 80)
    return { ok: false, error: 'برچسب روش ارسال باید ۲ تا ۸۰ نویسه باشد.' };

  const fallback = parseRange(form.get('fallback.min'), form.get('fallback.max'), 'بازه‌ی پیش‌فرض');
  if (!fallback.ok) return fallback;

  const bulk = form.get('intent') === 'bulk';
  const bulkRange = bulk ? parseRange(form.get('bulk.min'), form.get('bulk.max'), 'ویرایش دسته‌ای') : null;
  if (bulkRange && !bulkRange.ok) return bulkRange;
  const selected = new Set(form.getAll('sel').map((v) => Number(v)));
  if (bulk && selected.size === 0)
    return { ok: false, error: 'برای ویرایش دسته‌ای دست‌کم یک استان را تیک بزنید.' };

  const provinces: ShippingInput['provinces'] = [];
  for (const [id, name] of names) {
    if (bulkRange?.ok && selected.has(id)) {
      provinces.push({ id, range: bulkRange.value });
      continue;
    }
    const r = parseRange(form.get(`p.${id}.min`), form.get(`p.${id}.max`), name);
    if (!r.ok) return r;
    provinces.push({ id, range: r.value });
  }
  return { ok: true, value: { label, active: text('active') === '1', fallback: fallback.value, provinces } };
}
