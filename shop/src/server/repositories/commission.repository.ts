import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

/**
 * Affiliate referrals, commission rules and commissions (migration 015). commission_rules starts EMPTY: the amounts are
 * the client's decision; with no active rule no commission is created.
 */
export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

export type CommissionRuleRow = {
  id: string;
  name: string;
  kind: 'percent' | 'fixed';
  value: number;
  min_order_total: number;
  valid_from: Date | null;
  valid_to: Date | null;
  active: boolean;
};

export type CommissionRow = {
  id: string;
  order_id: string;
  affiliate_user_id: string;
  rule_id: string | null;
  base_amount: number;
  amount: number;
  status: CommissionStatus;
  created_at: Date;
  paid_at: Date | null;
};

const COMMISSION_COLS =
  'id::text, order_id::text, affiliate_user_id::text, rule_id::text, base_amount::float8, amount::float8, status, created_at, paid_at';

export const commissionRepository = {
  async referrerOf(buyerUserId: string, db?: Queryable): Promise<string | null> {
    const row = await queryOne<{ referrer: string }>(
      'commission.referrer',
      'SELECT referrer_user_id::text AS referrer FROM affiliate_referrals WHERE buyer_user_id = $1',
      [buyerUserId],
      db,
    );
    return row?.referrer ?? null;
  },

  async userByCode(code: string, db?: Queryable): Promise<string | null> {
    const row = await queryOne<{ user_id: string }>(
      'commission.by_code',
      'SELECT user_id::text FROM affiliate_codes WHERE code = $1',
      [code],
      db,
    );
    return row?.user_id ?? null;
  },

  /** A buyer's referrer is fixed at the first referral; false if the buyer already has one. */
  async refer(buyerUserId: string, referrerUserId: string, code: string, db?: Queryable): Promise<boolean> {
    const rows = await query<{ buyer_user_id: string }>(
      'commission.refer',
      `INSERT INTO affiliate_referrals (buyer_user_id, referrer_user_id, code) VALUES ($1, $2, $3)
       ON CONFLICT (buyer_user_id) DO NOTHING RETURNING buyer_user_id::text`,
      [buyerUserId, referrerUserId, code],
      db,
    );
    return rows.length === 1;
  },

  /** Rules in force at `at` (active, inside their window), best-defined first by id. Empty until the client sets some. */
  async activeRules(at: Date = new Date(), db?: Queryable): Promise<CommissionRuleRow[]> {
    return query<CommissionRuleRow>(
      'commission.rules',
      `SELECT id::text, name, kind, value::float8, min_order_total::float8, valid_from, valid_to, active
         FROM commission_rules
        WHERE active AND (valid_from IS NULL OR valid_from <= $1) AND (valid_to IS NULL OR valid_to > $1) ORDER BY id`,
      [at],
      db,
    );
  },

  /** One commission per order and affiliate (a repeat returns false). */
  async create(
    c: {
      orderId: string;
      affiliateUserId: string;
      ruleId: string | null;
      baseAmount: number;
      amount: number;
      level?: number;
      holdDays?: number;
    },
    db?: Queryable,
  ): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'commission.create',
      `INSERT INTO commissions (order_id, affiliate_user_id, rule_id, base_amount, amount, level, hold_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (order_id, affiliate_user_id) DO NOTHING RETURNING id::text`,
      [c.orderId, c.affiliateUserId, c.ruleId, c.baseAmount, c.amount, c.level ?? 1, c.holdDays ?? 0],
      db,
    );
    return rows.length === 1;
  },

  /**
   * The buyer's referral chain, nearest first: the buyer's referrer, then that referrer's own referrer ... up to `depth`
   * people. A person appears once (a loop in the data ends the chain) and never the buyer.
   */
  async referralChain(buyerUserId: string, depth: number, db?: Queryable): Promise<string[]> {
    const rows = await query<{ user_id: string }>(
      'commission.chain',
      `WITH RECURSIVE chain(user_id, level, path) AS (
         SELECT r.referrer_user_id, 1, ARRAY[r.buyer_user_id, r.referrer_user_id]
           FROM affiliate_referrals r WHERE r.buyer_user_id = $1
         UNION ALL
         SELECT r.referrer_user_id, c.level + 1, c.path || r.referrer_user_id
           FROM chain c JOIN affiliate_referrals r ON r.buyer_user_id = c.user_id
          WHERE c.level < $2 AND NOT r.referrer_user_id = ANY(c.path))
       SELECT user_id::text FROM chain ORDER BY level`,
      [buyerUserId, depth],
      db,
    );
    return rows.map((r) => r.user_id);
  },

  /** brand and category facts of products for the commission engine: the product's categories nearest first, then their parents */
  async lineFacts(
    productIds: readonly number[],
    db?: Queryable,
  ): Promise<Map<number, { brandId: number | null; categoryIds: number[] }>> {
    const rows = await query<{ id: number; brand_code: number | null; cats: number[] }>(
      'commission.line_facts',
      `WITH RECURSIVE leaf AS (
         SELECT p.id AS product_id, c AS code FROM product_catalog p, unnest(p.category) AS c WHERE p.id = ANY($1::int[])
       ), up(product_id, code, depth) AS (
         SELECT product_id, code, 0 FROM leaf
         UNION ALL
         SELECT u.product_id, c.parent_code, u.depth + 1 FROM up u JOIN categories c ON c.code = u.code
          WHERE c.parent_code IS NOT NULL AND u.depth < 12)
       SELECT p.id, p.brand_code, coalesce(array_agg(up.code ORDER BY up.depth) FILTER (WHERE up.code IS NOT NULL), '{}') AS cats
         FROM product_catalog p LEFT JOIN up ON up.product_id = p.id
        WHERE p.id = ANY($1::int[]) GROUP BY p.id, p.brand_code`,
      [productIds],
      db,
    );
    return new Map(rows.map((r) => [r.id, { brandId: r.brand_code, categoryIds: [...new Set(r.cats)] }]));
  },

  /** Order cancelled or refunded in full: its pending / approved commissions are cancelled (a paid one stays). Returns how many. */
  async cancelForOrder(orderId: string, db?: Queryable): Promise<number> {
    const rows = await query<{ id: string }>(
      'commission.cancel_order',
      `UPDATE commissions SET status = 'cancelled', decided_at = coalesce(decided_at, now())
        WHERE order_id = $1 AND status IN ('pending', 'approved') RETURNING id::text`,
      [orderId],
      db,
    );
    return rows.length;
  },

  /** The order was sent: each pending commission becomes approvable `hold_days` after that. */
  async setReleaseForOrder(orderId: string, sentAt: Date, db?: Queryable): Promise<number> {
    const rows = await query<{ id: string }>(
      'commission.release',
      `UPDATE commissions SET release_at = $2::timestamptz + hold_days * interval '1 day'
        WHERE order_id = $1 AND status = 'pending' AND release_at IS NULL RETURNING id::text`,
      [orderId, sentAt],
      db,
    );
    return rows.length;
  },

  async forOrder(orderId: string, db?: Queryable) {
    return query<{
      affiliate_user_id: string;
      level: number;
      amount: number;
      status: CommissionStatus;
      hold_days: number;
      release_at: Date | null;
    }>(
      'commission.for_order',
      `SELECT affiliate_user_id::text, level, amount::float8, status, hold_days, release_at
         FROM commissions WHERE order_id = $1 ORDER BY level`,
      [orderId],
      db,
    );
  },

  /** pending → approved | cancelled, approved → paid | cancelled (the database refuses any other step). */
  async transition(
    id: string,
    from: CommissionStatus,
    to: CommissionStatus,
    walletEntryId: string | null = null,
    db?: Queryable,
  ): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'commission.transition',
      `UPDATE commissions SET status = $3, decided_at = coalesce(decided_at, now()),
              paid_at = CASE WHEN $3 = 'paid' THEN now() ELSE paid_at END, wallet_entry_id = coalesce($4::bigint, wallet_entry_id)
        WHERE id = $1 AND status = $2 RETURNING id::text`,
      [id, from, to, walletEntryId],
      db,
    );
    return rows.length === 1;
  },

  async forAffiliate(affiliateUserId: string, db?: Queryable): Promise<CommissionRow[]> {
    return query<CommissionRow>(
      'commission.list',
      `SELECT ${COMMISSION_COLS} FROM commissions WHERE affiliate_user_id = $1 ORDER BY id DESC LIMIT 100`,
      [affiliateUserId],
      db,
    );
  },
};
