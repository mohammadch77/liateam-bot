/**
 * A pack's shape for the storefront (pure; no database, no purchase price): its steps with the current shop price
 * of each product, whether it can be bought now, and the shown numbers. The pack price itself comes from the
 * database (public.shop_pack_price), which alone may compare it with the purchase prices.
 */

export type PackStepInput = {
  label: string;
  /** null = no suitable product yet («به‌زودی») */
  productId: number | null;
};

/** What the shop knows about a product right now (null = no longer sold). */
export type PackProductState = { price: number; inStock: boolean } | null;

export type PackStepState = PackStepInput & {
  /** «به‌زودی» (no product) · «ناموجود» (out of stock or gone) · ok */
  status: 'soon' | 'out' | 'ok';
  /** the product's current shop price (after its own discount); null unless ok */
  price: number | null;
};

export type PackState = {
  steps: PackStepState[];
  /** the products to price (steps with a product, in order) */
  productIds: number[];
  /** sum of the current prices of the steps with a product (only meaningful when available) */
  total: number;
  /** every step with a product is in stock (and there is at least one) */
  available: boolean;
};

export function packState(
  steps: readonly PackStepInput[],
  product: (id: number) => PackProductState,
): PackState {
  let total = 0;
  let available = true;
  const productIds: number[] = [];
  const out: PackStepState[] = steps.map((s) => {
    if (s.productId === null) return { ...s, status: 'soon', price: null };
    productIds.push(s.productId);
    const p = product(s.productId);
    if (!p || !p.inStock) {
      available = false;
      return { ...s, status: 'out', price: null };
    }
    total += p.price;
    return { ...s, status: 'ok', price: p.price };
  });
  return { steps: out, productIds, total, available: available && productIds.length > 0 };
}

/** The saving the customer sees: the real difference between the items' total and the pack price. */
export function savingPercent(total: number, final: number): number {
  if (!(total > 0) || !(final < total)) return 0;
  return Math.max(1, Math.round(((total - final) / total) * 100));
}

/** Running now: switched on and inside its optional period. */
export function packLive(
  p: { active: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): boolean {
  return p.active && (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt > now);
}
