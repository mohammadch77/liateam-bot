/**
 * The delivery window shown at checkout. Liateam's answer carries no delivery time (only the price of «پست»), so the
 * window is the shop's own range for the method (and province) from shipping_methods / shipping_rules, plus the admin's
 * extra days (setting shipping.extra_days, default 1). With no range entered yet there is no window: the page then says
 * the time is announced after the order is placed. Days are calendar days counted from the order.
 */
export type Eta = { minDays: number; maxDays: number };

export type DeliveryWindow = Eta & { earliest: Date; latest: Date };

const DAY_MS = 86_400_000;

/**
 * @param method  the method's own range, or null
 * @param rule    the province's range (wins over the method's), or null
 * @param extraDays the admin's N (≥ 0)
 */
export function deliveryWindow(
  method: Eta | null,
  rule: Eta | null,
  extraDays: number,
  from: Date = new Date(),
): DeliveryWindow | null {
  const base = rule ?? method;
  if (!base) return null;
  const extra = Number.isFinite(extraDays) ? Math.max(0, Math.trunc(extraDays)) : 0;
  const minDays = base.minDays + extra;
  const maxDays = base.maxDays + extra;
  return {
    minDays,
    maxDays,
    earliest: new Date(from.getTime() + minDays * DAY_MS),
    latest: new Date(from.getTime() + maxDays * DAY_MS),
  };
}

/** «۳ تا ۶ روز کاری» style text, in digits the caller localises. */
export const etaText = (w: Eta): string =>
  w.minDays === w.maxDays ? `${w.minDays} روز` : `${w.minDays} تا ${w.maxDays} روز`;
