/**
 * What the customer pays for shipping. The price is always Liateam's own (from the live check); the shop may waive it
 * above a goods total («ارسال رایگان از مبلغ X», a switch and an amount in site_settings: shipping.free_enabled,
 * shipping.free_from_toman). The order keeps all three numbers so reports show what the shop paid for its customers:
 *   shipping_supplier_price = what Liateam charges · shipping_charged = what the customer pays · shipping_absorbed = the difference.
 * All amounts are TOMAN integers. «From X» includes X itself (a goods total of exactly X ships free).
 */
export type FreeShipping = { enabled: boolean; fromToman: number };

export type ShippingQuote = {
  supplierPrice: number;
  charged: number;
  absorbed: number;
  free: boolean;
};

export function quoteShipping(supplierPrice: number, goodsTotal: number, free: FreeShipping): ShippingQuote {
  if (!Number.isSafeInteger(supplierPrice) || supplierPrice < 0)
    throw new RangeError('shipping price must be a non-negative integer');
  if (!Number.isSafeInteger(goodsTotal) || goodsTotal < 0)
    throw new RangeError('goods total must be a non-negative integer');
  const isFree = free.enabled && free.fromToman > 0 && goodsTotal >= free.fromToman;
  const charged = isFree ? 0 : supplierPrice;
  return { supplierPrice, charged, absorbed: supplierPrice - charged, free: isFree };
}

/** The line shown in the header and on pages: null when the switch is off (nothing is promised). */
export const freeShippingFrom = (free: FreeShipping): number | null =>
  free.enabled && free.fromToman > 0 ? free.fromToman : null;
