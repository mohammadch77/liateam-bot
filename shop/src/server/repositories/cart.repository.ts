import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

/**
 * Carts (migration 012). A cart holds product codes and quantities only — never a price: prices are computed from the
 * database's price function whenever a cart is shown. The app never deletes: an item taken out has quantity 0.
 */
export type CartRow = {
  id: string;
  user_id: string | null;
  status: 'open' | 'merged' | 'ordered' | 'abandoned';
  /** the live check (public.order_jobs id) this cart waits on or holds */
  review_id: number | null;
};
export type CartItemRow = { product_id: number; quantity: number };

const COLS = 'id::text, user_id::text, status, review_id';
export const MAX_QUANTITY = 50;

export const cartRepository = {
  async findOpenForUser(userId: string, db?: Queryable): Promise<CartRow | null> {
    return queryOne<CartRow>(
      'cart.find_user',
      `SELECT ${COLS} FROM carts WHERE user_id = $1 AND status = 'open'`,
      [userId],
      db,
    );
  },

  async findOpenForGuest(tokenHash: string, db?: Queryable): Promise<CartRow | null> {
    return queryOne<CartRow>(
      'cart.find_guest',
      `SELECT ${COLS} FROM carts WHERE guest_token_hash = $1 AND status = 'open'`,
      [tokenHash],
      db,
    );
  },

  /** The user's open cart, made if there is none (the unique index keeps it to one even with two requests at once). */
  async openForUser(userId: string, db?: Queryable): Promise<CartRow> {
    const rows = await query<CartRow>(
      'cart.open_user',
      `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) WHERE status = 'open' AND user_id IS NOT NULL
         DO UPDATE SET updated_at = now() RETURNING ${COLS}`,
      [userId],
      db,
    );
    return rows[0]!;
  },

  async openForGuest(tokenHash: string, db?: Queryable): Promise<CartRow> {
    const rows = await query<CartRow>(
      'cart.open_guest',
      `INSERT INTO carts (guest_token_hash) VALUES ($1) ON CONFLICT (guest_token_hash) WHERE guest_token_hash IS NOT NULL
         DO UPDATE SET updated_at = now() RETURNING ${COLS}`,
      [tokenHash],
      db,
    );
    return rows[0]!;
  },

  /** Items still in the cart (quantity > 0), oldest first. */
  async items(cartId: string, db?: Queryable): Promise<CartItemRow[]> {
    return query<CartItemRow>(
      'cart.items',
      'SELECT product_id, quantity FROM cart_items WHERE cart_id = $1 AND quantity > 0 ORDER BY added_at, product_id',
      [cartId],
      db,
    );
  },

  /** Sets the quantity (0 takes the item out; above the limit is held at the limit). */
  async setQuantity(cartId: string, productId: number, quantity: number, db?: Queryable): Promise<void> {
    const q = Math.max(0, Math.min(MAX_QUANTITY, Math.trunc(quantity)));
    await query(
      'cart.set_quantity',
      `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [cartId, productId, q],
      db,
    );
    await query('cart.touch', 'UPDATE carts SET updated_at = now() WHERE id = $1', [cartId], db);
  },

  /** After sign-in the guest cart is closed as merged into the user's (its items were added by the service). */
  async closeMerged(guestCartId: string, userCartId: string, db?: Queryable): Promise<void> {
    await query(
      'cart.merge_close',
      `UPDATE carts SET status = 'merged', merged_into_id = $2 WHERE id = $1 AND status = 'open'`,
      [guestCartId, userCartId],
      db,
    );
  },

  /** Units in the cart that can still be bought (the header badge): products no longer sold or out of stock are not counted. */
  async units(cartId: string, db?: Queryable): Promise<number> {
    const row = await queryOne<{ n: number }>(
      'cart.units',
      `SELECT coalesce(sum(i.quantity), 0)::int AS n
         FROM cart_items i JOIN public.product_catalog p ON p.id = i.product_id
        WHERE i.cart_id = $1 AND i.quantity > 0 AND p.is_sellable AND p.price > 0 AND p.missing_since IS NULL AND p.stock > 0`,
      [cartId],
      db,
    );
    return row?.n ?? 0;
  },

  /** The cart's last change (ms since 1970): the newest of the cart and its lines. Views compare it to know which data is newer. */
  async rev(cartId: string, db?: Queryable): Promise<number> {
    const row = await queryOne<{ rev: number }>(
      'cart.rev',
      `SELECT floor(extract(epoch FROM greatest(c.updated_at, coalesce(max(i.updated_at), c.updated_at))) * 1000)::float8 AS rev
         FROM carts c LEFT JOIN cart_items i ON i.cart_id = c.id WHERE c.id = $1 GROUP BY c.id`,
      [cartId],
      db,
    );
    return row?.rev ?? 0;
  },

  /** Remembers the live check the cart is on (null forgets it). */
  async setReview(cartId: string, reviewId: number | null, db?: Queryable): Promise<void> {
    await query('cart.set_review', 'UPDATE carts SET review_id = $2 WHERE id = $1', [cartId, reviewId], db);
  },

  /** The cart became an order (it is not shown again). */
  async markOrdered(cartId: string, db?: Queryable): Promise<void> {
    await query(
      'cart.ordered',
      `UPDATE carts SET status = 'ordered' WHERE id = $1 AND status = 'open'`,
      [cartId],
      db,
    );
  },
};
