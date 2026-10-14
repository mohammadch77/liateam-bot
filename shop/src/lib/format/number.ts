/** Persian digits with the Persian thousands separator (٬), e.g. 977000 → «۹۷۷٬۰۰۰». */
const faInteger = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0, useGrouping: true });
const faDecimal = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1, useGrouping: true });

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`not a finite number: ${n}`);
  return faInteger.format(n);
}

/** One decimal place, e.g. a rating 4.7 → «۴٫۷». */
export function formatDecimal(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`not a finite number: ${n}`);
  return faDecimal.format(n);
}

/** Digits only (no grouping): phone numbers, codes, years. */
export function toFaDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}
