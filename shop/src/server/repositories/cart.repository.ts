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
};
export type CartItemRow = { product_id: number; quantity: number };

const COLS = 'id::text, user_id::text, status';
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

  /**
   * After sign-in: the guest cart's items are added to the user's cart (quantities add up, capped at the limit) and the
   * guest cart is closed as 'merged'. Run inside one transaction. Returns how many products were moved.
   */
  async mergeGuestIntoUser(guestCartId: string, userCartId: string, db?: Queryable): Promise<number> {
    const moved = await query<{ product_id: number }>(
      'cart.merge_items',
      `INSERT INTO cart_items (cart_id, product_id, quantity)
         SELECT $2, g.product_id, g.quantity FROM cart_items g WHERE g.cart_id = $1 AND g.quantity > 0
       ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = LEAST(${MAX_QUANTITY}, cart_items.quantity + EXCLUDED.quantity)
       RETURNING product_id`,
      [guestCartId, userCartId],
      db,
    );
    await query(
      'cart.merge_close',
      `UPDATE carts SET status = 'merged', merged_into_id = $2 WHERE id = $1 AND status = 'open'`,
      [guestCartId, userCartId],
      db,
    );
    return moved.length;
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
