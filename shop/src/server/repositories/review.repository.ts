import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

/** Reviews written on our site (shop schema, table site_reviews). Synced Liateam reviews: catalog.repository. */
export type SiteReviewRow = {
  id: string;
  product_id: number;
  author_name: string | null;
  rating: number; // 1-5
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: Date;
};

export const reviewRepository = {
  async insert(
    r: {
      productId: number;
      userId: string;
      authorName: string | null;
      rating: number;
      body: string;
      ip: string | null;
    },
    db?: Queryable,
  ): Promise<{ id: string }> {
    const row = await queryOne<{ id: string }>(
      'review.insert',
      `INSERT INTO site_reviews (product_id, user_id, author_name, rating, body, ip)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
      [r.productId, r.userId, r.authorName, r.rating, r.body, r.ip],
      db,
    );
    return row!;
  },

  /** Rate limiting: reviews this user wrote in the last `seconds`, and whether one is pending for the product. */
  async recentByUser(userId: string, productId: number, seconds: number, db?: Queryable) {
    const row = await queryOne<{ recent: number; pending: boolean }>(
      'review.recent_by_user',
      `SELECT count(*) FILTER (WHERE created_at > now() - make_interval(secs => $3))::int AS recent,
              bool_or(product_id = $2 AND status = 'pending') AS pending
         FROM site_reviews WHERE user_id = $1`,
      [userId, productId, seconds],
      db,
    );
    return { recent: row?.recent ?? 0, pending: !!row?.pending };
  },

  /** Product page: approved reviews only, newest first. */
  async approvedFor(productId: number, limit: number): Promise<SiteReviewRow[]> {
    return query<SiteReviewRow>(
      'review.approved_for',
      `SELECT id::text, product_id, author_name, rating, body, status, created_at FROM site_reviews
        WHERE product_id = $1 AND status = 'approved' ORDER BY created_at DESC LIMIT $2`,
      [productId, limit],
    );
  },

  /** Moderation queue, oldest first. */
  async pending(limit: number): Promise<SiteReviewRow[]> {
    return query<SiteReviewRow>(
      'review.pending',
      `SELECT id::text, product_id, author_name, rating, body, status, created_at FROM site_reviews
        WHERE status = 'pending' ORDER BY created_at LIMIT $1`,
      [limit],
    );
  },

  async moderate(id: string, status: 'approved' | 'rejected', adminId: string, db?: Queryable) {
    return queryOne<{ id: string; product_id: number }>(
      'review.moderate',
      `UPDATE site_reviews SET status = $2, moderated_at = now(), moderated_by = $3
        WHERE id = $1 AND status = 'pending' RETURNING id::text, product_id`,
      [id, status, adminId],
      db,
    );
  },
};
