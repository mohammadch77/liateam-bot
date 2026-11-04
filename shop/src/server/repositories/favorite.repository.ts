import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

/**
 * The customer's favourite products (migration 027). The app role cannot DELETE: taking a product out sets removed_at, putting it back
 * clears it (one row per user and product). Only product codes are stored; names and prices come from the catalog when shown.
 */
export const MAX_FAVORITES = 300;

export const favoriteRepository = {
  /** the product codes on the list, newest first */
  async ids(userId: string, db?: Queryable): Promise<number[]> {
    const rows = await query<{ product_id: number }>(
      'favorite.ids',
      'SELECT product_id FROM favorites WHERE user_id = $1 AND removed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $2',
      [userId, MAX_FAVORITES],
      db,
    );
    return rows.map((r) => r.product_id);
  },

  async count(userId: string, db?: Queryable): Promise<number> {
    const r = await queryOne<{ n: number }>(
      'favorite.count',
      'SELECT count(*)::int AS n FROM favorites WHERE user_id = $1 AND removed_at IS NULL',
      [userId],
      db,
    );
    return r?.n ?? 0;
  },

  /** puts a product on the list (a removed one comes back as the newest; one already there stays where it is) */
  async add(userId: string, productId: number, db?: Queryable): Promise<void> {
    await query(
      'favorite.add',
      `INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)
       ON CONFLICT (user_id, product_id) DO UPDATE
         SET removed_at = NULL, created_at = CASE WHEN favorites.removed_at IS NOT NULL THEN now() ELSE favorites.created_at END`,
      [userId, productId],
      db,
    );
  },

  /** takes a product off the list (soft: the row stays with removed_at) */
  async remove(userId: string, productId: number, db?: Queryable): Promise<void> {
    await query(
      'favorite.remove',
      'UPDATE favorites SET removed_at = now() WHERE user_id = $1 AND product_id = $2 AND removed_at IS NULL',
      [userId, productId],
      db,
    );
  },
};
