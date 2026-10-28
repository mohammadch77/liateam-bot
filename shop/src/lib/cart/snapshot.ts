import { capQuantity, discountPercentOf, totalsOf, type CartTotals } from './totals.ts';

/**
 * The cart as every view shows it — the header badge, the mini-cart, the cart page — one shape computed on the server.
 * `rev` is the cart's last-change time (ms since 1970, from the database): of two snapshots the one with the higher
 * `rev` is the newer, so a view never falls back to older data than another one already has.
 */
export type SnapshotLine = {
  productId: number;
  name: string;
  href: string;
  imageUrl: string | null;
  quantity: number;
  /** the most this line can hold now (stock, never above 50) */
  maxQuantity: number;
  /** what the customer pays per unit */
  unitPrice: number;
  /** Liateam's list price per unit */
  unitListPrice: number;
  discountPercent: number;
  lineTotal: number;
};

export type CartSnapshot = CartTotals & { rev: number; items: SnapshotLine[] };

export const EMPTY_SNAPSHOT: CartSnapshot = {
  rev: 0,
  items: [],
  units: 0,
  lines: 0,
  itemsTotal: 0,
  listTotal: 0,
  discountTotal: 0,
};

/** The newer of two snapshots (the first wins a tie: it is the one that carries an optimistic change). */
export function newer(
  a: CartSnapshot | null | undefined,
  b: CartSnapshot | null | undefined,
): CartSnapshot | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.rev >= b.rev ? a : b;
}

/** A snapshot built from its lines: the totals follow the lines. */
export function snapshotOf(rev: number, items: SnapshotLine[]): CartSnapshot {
  return { rev, items, ...totalsOf(items) };
}

/**
 * The snapshot a change will most likely produce, shown at once while the server confirms it (optimistic): the line's
 * quantity is set (0 removes it; above the line's own maximum it is held at the maximum). Same `rev` as the base.
 */
export function withQuantity(base: CartSnapshot, productId: number, quantity: number): CartSnapshot {
  const items = base.items.flatMap((l): SnapshotLine[] => {
    if (l.productId !== productId) return [l];
    const q = capQuantity(quantity, l.maxQuantity);
    if (q <= 0) return [];
    return [
      {
        ...l,
        quantity: q,
        lineTotal: l.unitPrice * q,
        discountPercent: discountPercentOf(l.unitPrice, l.unitListPrice),
      },
    ];
  });
  return snapshotOf(base.rev, items);
}
