import type { PricedLine } from '../cart/totals.ts';
import { quoteShipping, type FreeShipping, type ShippingQuote } from '../shipping.ts';

/**
 * The live check against Liateam made before payment (the sync bot's «review» job) and what the shop does with it.
 * Pure: the answer and the cart come in, a verdict or an order draft comes out. Prices in the answer are LIATEAM's
 * (what the bot reads from validate-basket); the shop's own prices are the cart lines'. The bot strips its purchase prices.
 */
export type ReviewItem = {
  product_id: number;
  name: string | null;
  requested: number;
  /** what Liateam can supply now (0 = none) */
  quantity: number;
  status: 'ok' | 'adjusted' | 'unavailable';
  /** Liateam's price per unit now */
  unit_price?: number;
  line_total?: number;
  /** the price the shop had before this check, when it differs */
  price_changed?: { old: number; new: number } | null;
  limited?: boolean;
};

export type ReviewResult = {
  ok: boolean;
  reason: string | null;
  city_id: number;
  items: ReviewItem[];
  shipping: { price: number; title: string } | null;
  /** Liateam-priced goods */
  items_total: number;
  /** Liateam-priced goods + Liateam's shipping: the number the bot compares with before placing (expected_total) */
  total: number;
  urgent: boolean;
  /** when the bot releases its hold on the quantities (15 minutes) */
  expires_at: string;
};

export type LineVerdict = {
  productId: number;
  requested: number;
  /** what Liateam can supply */
  available: number;
  status: 'ok' | 'adjusted' | 'unavailable' | 'missing';
  priceChanged: { old: number; new: number } | null;
  limited: boolean;
};

export type ReviewVerdict = {
  lines: LineVerdict[];
  /** every line can be supplied as requested, nothing is stale: the order can be made */
  canOrder: boolean;
  /** products to take out of the cart (none of the quantity is available) */
  unavailable: number[];
  /** products whose quantity must come down to what Liateam has */
  adjusted: Array<{ productId: number; quantity: number }>;
  expired: boolean;
};

const sameCart = (lines: readonly Pick<PricedLine, 'productId'>[], review: ReviewResult) =>
  lines.length === review.items.length &&
  lines.every((l) => review.items.some((i) => i.product_id === l.productId));

/** What the check says about each cart line. `now` is injected for tests. */
export function assessReview(
  lines: readonly Pick<PricedLine, 'productId' | 'quantity'>[],
  review: ReviewResult,
  now: Date = new Date(),
): ReviewVerdict {
  const byId = new Map(review.items.map((i) => [i.product_id, i]));
  const verdicts: LineVerdict[] = lines.map((l) => {
    const i = byId.get(l.productId);
    if (!i)
      return {
        productId: l.productId,
        requested: l.quantity,
        available: 0,
        status: 'missing',
        priceChanged: null,
        limited: false,
      };
    const status = i.status === 'ok' && i.quantity < l.quantity ? 'adjusted' : i.status;
    return {
      productId: l.productId,
      requested: l.quantity,
      available: i.quantity,
      status,
      priceChanged: i.price_changed ?? null,
      limited: i.limited ?? false,
    };
  });
  const expired = Date.parse(review.expires_at) <= now.getTime();
  return {
    lines: verdicts,
    canOrder:
      review.ok &&
      !expired &&
      Boolean(review.shipping) &&
      sameCart(lines, review) &&
      verdicts.every((v) => v.status === 'ok'),
    unavailable: verdicts
      .filter((v) => v.status === 'unavailable' || v.status === 'missing')
      .map((v) => v.productId),
    adjusted: verdicts
      .filter((v) => v.status === 'adjusted')
      .map((v) => ({ productId: v.productId, quantity: v.available })),
    expired,
  };
}

export type OrderDraftItem = {
  productId: number;
  name: string;
  quantity: number;
  unitListPrice: number;
  unitPrice: number;
  discountPercent: number;
};

export type OrderDraft = {
  items: OrderDraftItem[];
  itemsTotal: number;
  discountTotal: number;
  shipping: ShippingQuote;
  /** what the customer pays: goods + the shipping he is charged */
  totalPayable: number;
  /** Liateam-priced goods + Liateam's shipping, kept as orders.live_total and sent to the bot as expected_total */
  expectedTotal: number;
};

export type DraftFailure = 'not_ok' | 'expired' | 'cart_changed' | 'stale_price' | 'inconsistent';
export type DraftResult = { ok: true; draft: OrderDraft } | { ok: false; reason: DraftFailure };

/**
 * The order the cart and a good check make. The money is computed here, on the server, from the cart's shop prices and
 * Liateam's check: the browser sends neither. Refuses (and the page asks for a new check) when the check is not ok, has
 * expired, does not match the cart, or when Liateam's price in the check is not the list price the cart shows.
 */
export function buildOrderDraft(
  lines: readonly PricedLine[],
  review: ReviewResult,
  free: FreeShipping,
  now: Date = new Date(),
): DraftResult {
  if (!review.ok || !review.shipping) return { ok: false, reason: 'not_ok' };
  if (Date.parse(review.expires_at) <= now.getTime()) return { ok: false, reason: 'expired' };
  if (!lines.length || !sameCart(lines, review)) return { ok: false, reason: 'cart_changed' };

  const byId = new Map(review.items.map((i) => [i.product_id, i]));
  let liateamGoods = 0;
  const items: OrderDraftItem[] = [];
  for (const l of lines) {
    const i = byId.get(l.productId)!;
    if (i.status !== 'ok' || i.quantity !== l.quantity) return { ok: false, reason: 'cart_changed' };
    if (i.unit_price === undefined || i.unit_price !== l.unitListPrice)
      return { ok: false, reason: 'stale_price' };
    const unitPrice = Math.min(l.unitPrice, l.unitListPrice); // never above Liateam's price
    liateamGoods += i.unit_price * l.quantity;
    items.push({
      productId: l.productId,
      name: l.name,
      quantity: l.quantity,
      unitListPrice: l.unitListPrice,
      unitPrice,
      discountPercent:
        l.unitListPrice > 0
          ? Math.round(((l.unitListPrice - unitPrice) / l.unitListPrice) * 10_000) / 100
          : 0,
    });
  }
  const expectedTotal = liateamGoods + review.shipping.price;
  if (review.items_total !== liateamGoods || review.total !== expectedTotal)
    return { ok: false, reason: 'inconsistent' };

  const itemsTotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const shipping = quoteShipping(review.shipping.price, itemsTotal, free);
  return {
    ok: true,
    draft: {
      items,
      itemsTotal,
      discountTotal: liateamGoods - itemsTotal,
      shipping,
      totalPayable: itemsTotal + shipping.charged,
      expectedTotal,
    },
  };
}
