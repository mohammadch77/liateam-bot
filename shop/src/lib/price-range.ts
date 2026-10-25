/**
 * The listing price filter (?min=…&max=…, toman, on the final price after discounts). Typed by people: Persian,
 * Arabic-Indic or Latin digits, with or without thousands separators («۱٬۲۵۰٬۰۰۰», «1,250,000», «۱۲۵۰۰۰۰»).
 */
export const PRICE_FILTER = { min: 0, max: 1_000_000_000, step: 10_000 } as const;

const DIGITS: Record<string, string> = {};
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGITS[d] = String(i)));
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGITS[d] = String(i)));

/** A typed amount → whole toman, or undefined (empty, not a number, out of range). */
export function parsePrice(raw: unknown): number | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const latin = String(raw)
    .trim()
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d] ?? d)
    .replace(/[\s,٬،'’_.]/g, ''); // separators (dots too: «1.250.000» is how some people group digits)
  if (!/^\d{1,10}$/.test(latin)) return undefined;
  const n = Number(latin);
  return n >= PRICE_FILTER.min && n <= PRICE_FILTER.max ? n : undefined;
}

/** Both ends, swapped when given the wrong way round; an end that equals the open end is dropped. */
export function priceRange(min: unknown, max: unknown): { min?: number; max?: number } {
  let lo = parsePrice(min);
  let hi = parsePrice(max);
  if (lo !== undefined && hi !== undefined && lo > hi) [lo, hi] = [hi, lo];
  return { min: lo || undefined, max: hi };
}

/** «۱٬۲۵۰٬۰۰۰» for an input's value. */
export const formatPriceInput = (n: number | undefined) =>
  n === undefined ? '' : new Intl.NumberFormat('fa-IR').format(n);
