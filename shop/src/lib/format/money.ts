import { formatDecimal, formatNumber } from './number';

/**
 * Money rules — the ONLY place currency is converted or formatted.
 * Amounts are stored and passed around in RIAL (integers, as the supplier and the database use them) and shown
 * in TOMAN (1 toman = 10 rial). Never divide by 10 or format a price anywhere else.
 */
export type Rial = number;

function assertRial(rial: Rial): void {
  if (!Number.isSafeInteger(rial) || rial < 0) throw new RangeError(`invalid rial amount: ${rial}`);
}

/** 9_770_000 rial → 977_000 toman. Rial amounts below 10 round to the nearest toman. */
export function rialToToman(rial: Rial): number {
  assertRial(rial);
  return Math.round(rial / 10);
}

/** 9_770_000 rial → «۹۷۷٬۰۰۰» (number only; the «تومان» unit is rendered separately and smaller). */
export function formatToman(rial: Rial): string {
  return formatNumber(rialToToman(rial));
}

/** 9_770_000 rial → «۹۷۷٬۰۰۰ تومان» for plain-text places (aria labels, SMS, meta). */
export function formatTomanText(rial: Rial): string {
  return `${formatToman(rial)} تومان`;
}

/** Whole-percent discount between the old and current price; 0 when there is no real discount. */
export function discountPercent(rial: Rial, oldRial: Rial | null | undefined): number {
  assertRial(rial);
  if (oldRial == null || oldRial <= rial) return 0;
  assertRial(oldRial);
  return Math.round(((oldRial - rial) / oldRial) * 100);
}

/** «۲۰٪» */
export function formatPercent(percent: number): string {
  return `${formatNumber(percent)}٪`;
}

/** Compact amount for tight spots (mobile wallet pill): «۱۲۰ هزار», «۱٫۲ میلیون», «۸۵۰» (toman, no unit). */
export function formatTomanShort(rial: Rial): string {
  const toman = rialToToman(rial);
  if (toman >= 1_000_000) return `${formatDecimal(Math.floor(toman / 100_000) / 10)} میلیون`;
  if (toman >= 1_000) return `${formatNumber(Math.floor(toman / 1_000))} هزار`;
  return formatNumber(toman);
}
