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
    },
    db?: Queryable,
  ): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'commission.create',
      `INSERT INTO commissions (order_id, affiliate_user_id, rule_id, base_amount, amount) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (order_id, affiliate_user_id) DO NOTHING RETURNING id::text`,
      [c.orderId, c.affiliateUserId, c.ruleId, c.baseAmount, c.amount],
      db,
    );
    return rows.length === 1;
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
