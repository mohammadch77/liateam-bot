import { formatDecimal, formatNumber } from './number';

/**
 * Money rules — the ONLY place amounts are converted or formatted.
 *
 * UNIT: every amount in this system is an integer in TOMAN — Liateam's own unit, stored unchanged by the sync bot
 * (see SOURCE_PRICE_UNIT in src/normalize.mjs of the bot, proven against the prices Liateam's product pages show).
 * Display is therefore formatting only; nothing is ever divided by 10. Rial exists only at outside edges that
 * require it (schema.org IRR, a rial-based payment gateway) and is produced here, by tomanToRial().
 */
export type Toman = number;

function assertToman(amount: Toman): void {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`invalid toman amount: ${amount}`);
}

/** 749_000 → «۷۴۹٬۰۰۰» (number only; the «تومان» unit is rendered separately and smaller). */
export function formatToman(amount: Toman): string {
  assertToman(amount);
  return formatNumber(amount);
}

/** 749_000 → «۷۴۹٬۰۰۰ تومان» for plain-text places (aria labels, SMS, meta). */
export function formatTomanText(amount: Toman): string {
  return `${formatToman(amount)} تومان`;
}

/** For edges that require rial (schema.org IRR, rial payment gateways). 749_000 toman → 7_490_000 rial. */
export function tomanToRial(amount: Toman): number {
  assertToman(amount);
  return amount * 10;
}

/** Whole-percent discount between the old and current price; 0 when there is no real discount. */
export function discountPercent(amount: Toman, oldAmount: Toman | null | undefined): number {
  assertToman(amount);
  if (oldAmount == null || oldAmount <= amount) return 0;
  assertToman(oldAmount);
  return Math.round(((oldAmount - amount) / oldAmount) * 100);
}

/** «۲۰٪» */
export function formatPercent(percent: number): string {
  return `${formatNumber(percent)}٪`;
}

/** Compact amount for tight spots (mobile wallet pill): «۱۲۰ هزار», «۱٫۲ میلیون», «۸۵۰» (toman, no unit). */
export function formatTomanShort(amount: Toman): string {
  assertToman(amount);
  if (amount >= 1_000_000) return `${formatDecimal(Math.floor(amount / 100_000) / 10)} میلیون`;
  if (amount >= 1_000) return `${formatNumber(Math.floor(amount / 1_000))} هزار`;
  return formatNumber(amount);
}
