/**
 * Cart arithmetic, pure. A cart stores product codes and quantities only; the prices below always come from the
 * database's price function (pricing.service), never from the browser. Amounts are TOMAN integers.
 */
export const MAX_LINE_QUANTITY = 50;

export type CartItem = { productId: number; quantity: number };

/** A cart line with what the shop shows and charges now. */
export type PricedLine = {
  productId: number;
  name: string;
  href: string;
  imageUrl: string | null;
  quantity: number;
  /** what the customer pays per unit (the shop's price) */
  unitPrice: number;
  /** Liateam's list price per unit (struck through when higher than unitPrice) */
  unitListPrice: number;
  /** units in stock now; the quantity can never go above it */
  stockCount: number;
};

export type CartTotals = {
  /** units in the cart (what the header badge shows) */
  units: number;
  /** distinct products */
  lines: number;
  /** what the customer pays for goods */
  itemsTotal: number;
  /** the same goods at Liateam's list price */
  listTotal: number;
  /** listTotal − itemsTotal */
  discountTotal: number;
};

/** The highest quantity of one product a cart may hold: the stock, and never above the limit; 0 = cannot be added. */
export const maxQuantity = (stockCount: number): number =>
  Math.max(0, Math.min(MAX_LINE_QUANTITY, Math.trunc(Number.isFinite(stockCount) ? stockCount : 0)));

/** A requested quantity held inside 0..max (a fraction or a bad number gives 0). */
export function capQuantity(requested: number, stockCount: number): number {
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.min(maxQuantity(stockCount), Math.trunc(requested)));
}

export function totalsOf(
  lines: readonly Pick<PricedLine, 'quantity' | 'unitPrice' | 'unitListPrice'>[],
): CartTotals {
  let units = 0;
  let itemsTotal = 0;
  let listTotal = 0;
  for (const l of lines) {
    units += l.quantity;
    itemsTotal += l.unitPrice * l.quantity;
    listTotal += Math.max(l.unitListPrice, l.unitPrice) * l.quantity;
  }
  return { units, lines: lines.length, itemsTotal, listTotal, discountTotal: listTotal - itemsTotal };
}

/**
 * The cart a guest built before signing in, merged into the user's own: quantities add up per product (capped by
 * `stockOf`, then by the limit); a product that is not sellable any more (stock 0) is dropped.
 */
export function mergeCartItems(
  user: readonly CartItem[],
  guest: readonly CartItem[],
  stockOf: (productId: number) => number,
): CartItem[] {
  const sum = new Map<number, number>();
  for (const i of [...user, ...guest])
    sum.set(i.productId, (sum.get(i.productId) ?? 0) + Math.max(0, Math.trunc(i.quantity)));
  return [...sum]
    .map(([productId, quantity]) => ({ productId, quantity: capQuantity(quantity, stockOf(productId)) }))
    .filter((i) => i.quantity > 0);
}

/** Percent off the list price, for a label («۱۰٪»); 0 when there is none. */
export const discountPercentOf = (unitPrice: number, unitListPrice: number): number =>
  unitListPrice > 0 && unitPrice < unitListPrice
    ? Math.round(((unitListPrice - unitPrice) / unitListPrice) * 100)
    : 0;
