/**
 * Which of our own discounts applies to a product (pure; no database, no purchase price). The final price itself
 * is computed in the database (public.shop_offer_prices), which alone may see the purchase price.
 */

export type DiscountScope = 'product' | 'category' | 'brand' | 'all';
export type DiscountKind = 'percent' | 'amount';

export type Discount = {
  id: number;
  scope: DiscountScope;
  /** product id / category code / brand code; null for 'all' */
  targetCode: number | null;
  kind: DiscountKind;
  /** percent (1–90) or toman */
  value: number;
  startsAt: Date;
  endsAt: Date | null;
  active: boolean;
  /** the admin allowed selling under the purchase price with this discount */
  allowLoss: boolean;
  campaignId: number | null;
  /** the campaign's own state (a discount of a stopped or finished campaign does not run) */
  campaignActive: boolean | null;
  campaignEndsAt: Date | null;
};

/** What the pricing needs to know about a product. */
export type PricedProduct = {
  id: number;
  /** Liateam's price, toman */
  price: number;
  /** its categories and all their ancestors (a discount on «مراقبت پوست» covers every sub-category) */
  categories: readonly number[];
  brandCode: number | null;
};

export type ManualDiscount = {
  percent: number;
  amount: number;
  discountId: number;
  campaignId: number | null;
  allowLoss: boolean;
};

export const NO_DISCOUNT: ManualDiscount = {
  percent: 0,
  amount: 0,
  discountId: 0,
  campaignId: null,
  allowLoss: false,
};

/** Running now: switched on, started, not ended, and its campaign (if any) switched on and not ended. */
export function isLive(d: Discount, now: Date): boolean {
  if (!d.active || d.startsAt > now || (d.endsAt && d.endsAt <= now)) return false;
  if (d.campaignId === null) return true;
  return d.campaignActive === true && (!d.campaignEndsAt || d.campaignEndsAt > now);
}

export function covers(d: Discount, p: PricedProduct): boolean {
  switch (d.scope) {
    case 'all':
      return true;
    case 'product':
      return d.targetCode === p.id;
    case 'category':
      return d.targetCode !== null && p.categories.includes(d.targetCode);
    case 'brand':
      return d.targetCode !== null && d.targetCode === p.brandCode;
  }
}

/** The discount in toman on this product's price (an amount never more than the price). */
export function worth(d: Discount, price: number): number {
  return d.kind === 'percent' ? (price * d.value) / 100 : Math.min(d.value, price);
}

/** The best (largest) live discount covering the product; discounts are never added together. */
export function bestManual(p: PricedProduct, discounts: readonly Discount[], now: Date): ManualDiscount {
  let best: Discount | null = null;
  let bestWorth = 0;
  for (const d of discounts) {
    if (!isLive(d, now) || !covers(d, p)) continue;
    const w = worth(d, p.price);
    if (w > bestWorth || (w === bestWorth && best && d.id < best.id)) {
      best = d;
      bestWorth = w;
    }
  }
  if (!best) return NO_DISCOUNT;
  return {
    percent: best.kind === 'percent' ? best.value : 0,
    amount: best.kind === 'amount' ? Math.min(best.value, p.price) : 0,
    discountId: best.id,
    campaignId: best.campaignId,
    allowLoss: best.allowLoss,
  };
}

/** The percent the customer sees: the real difference between the struck-through and the final price. */
export function shownPercent(price: number, final: number): number {
  if (!(price > 0) || !(final < price)) return 0;
  return Math.max(1, Math.round(((price - final) / price) * 100));
}
