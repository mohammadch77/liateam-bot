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


/** One filter for an affiliate's own lists / export (all optional; dates are Tehran calendar days, inclusive). */
export type CommissionFilter = { status: CommissionStatus | null; from: string | null; to: string | null };

export type AffiliateCommissionRow = {
  id: string;
  level: number;
  status: CommissionStatus;
  base_amount: number;
  amount: number;
  hold_days: number;
  created_at: Date;
  release_at: Date | null;
  paid_at: Date | null;
  /** the rule's kind and value as they were: a percent or a fixed amount (read from the rule at the time of listing) */
  rule_kind: 'percent' | 'fixed' | null;
  rule_value: number | null;
};

/** a person in an affiliate's network: nothing but what the privacy rule allows (first name, last four digits, join date, order count) */
export type NetworkRow = {
  /** the referred user's id: only ever turned into an opaque token for the address (never shown) */
  buyer_id: string;
  first_name: string | null;
  phone_last4: string;
  joined_at: Date;
  orders: number;
  /** what this affiliate earned from the person so far (cancelled ones left out) */
  commission: number;
};

/** one paid order of a referred person, as the affiliate may see it */
export type PersonOrderRow = {
  order_number: string;
  paid_at: Date;
  order_status: string;
  items_total: number;
  base_amount: number | null;
  commission: number | null;
  commission_status: CommissionStatus | null;
  rule_kind: 'percent' | 'fixed' | null;
  rule_value: number | null;
};

export type AdminCommissionRow = {
  id: string;
  order_number: string;
  order_status: string;
  affiliate_user_id: string;
  affiliate_phone: string;
  level: number;
  status: CommissionStatus;
  manual_approval: boolean;
  base_amount: number;
  amount: number;
  created_at: Date;
  release_at: Date | null;
  paid_at: Date | null;
  cancel_reason: string | null;
};

export type PayableRow = {
  id: string;
  affiliate_user_id: string;
  amount: number;
  status: CommissionStatus;
  manual_approval: boolean;
  release_at: Date | null;
  order_id: string;
  order_number: string;
  order_status: string;
};

/** WHERE for the affiliate's own filters: $1 is always the user; the rest follow in order */
function filterSql(f: CommissionFilter, startAt: number): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  let n = startAt;
  if (f.status) {
    parts.push(`c.status = $${n++}::commission_status`);
    args.push(f.status);
  }
  if (f.from) {
    parts.push(`(c.created_at AT TIME ZONE 'Asia/Tehran')::date >= $${n++}::date`);
    args.push(f.from);
  }
  if (f.to) {
    parts.push(`(c.created_at AT TIME ZONE 'Asia/Tehran')::date <= $${n++}::date`);
    args.push(f.to);
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', args };
}

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

  /** How many rules can make a commission right now: active, inside their dates, and for the one level that exists. */
  async usableRuleCount(db?: Queryable): Promise<number> {
    const r = await queryOne<{ n: number }>(
      'commission.usable_rules',
      `SELECT count(*)::int AS n FROM commission_rules
        WHERE active AND level = 1 AND (valid_from IS NULL OR valid_from <= now()) AND (valid_to IS NULL OR valid_to > now())`,
      [],
      db,
    );
    return r?.n ?? 0;
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
      manualApproval?: boolean;
      /** the rule's kind and value as they are now (kept on the row) */
      ruleKind?: 'percent' | 'fixed' | null;
      ruleValue?: number | null;
    },
    db?: Queryable,
  ): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'commission.create',
      `INSERT INTO commissions (order_id, affiliate_user_id, rule_id, base_amount, amount, level, hold_days, manual_approval, rule_kind, rule_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (order_id, affiliate_user_id) DO NOTHING RETURNING id::text`,
      [c.orderId, c.affiliateUserId, c.ruleId, c.baseAmount, c.amount, c.level ?? 1, c.holdDays ?? 0, c.manualApproval === true, c.ruleKind ?? null, c.ruleValue ?? null],
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
      `UPDATE commissions SET status = $3::commission_status, decided_at = coalesce(decided_at, now()),
              paid_at = CASE WHEN $3::commission_status = 'paid' THEN now() ELSE paid_at END, wallet_entry_id = coalesce($4::bigint, wallet_entry_id)
        WHERE id = $1 AND status = $2::commission_status RETURNING id::text`,
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
  // ───────── payout (task G) ─────────

  /** Pending automatic commissions whose order was sent and whose hold has passed: the next ones to pay into a wallet. */
  async payoutCandidates(limit: number, db?: Queryable): Promise<string[]> {
    const rows = await query<{ id: string }>(
      'commission.payout_candidates',
      `SELECT c.id::text FROM commissions c JOIN orders o ON o.id = c.order_id
        WHERE c.status = 'pending' AND NOT c.manual_approval AND c.release_at IS NOT NULL AND c.release_at <= now()
          AND o.status = 'sent'
        ORDER BY c.release_at, c.id LIMIT $1`,
      [limit],
      db,
    );
    return rows.map((r) => r.id);
  },

  /** The commission with its order's status, locked for the transaction. */
  async lockPayable(id: string, db: Queryable): Promise<PayableRow | null> {
    return queryOne<PayableRow>(
      'commission.lock_payable',
      `SELECT c.id::text, c.affiliate_user_id::text, c.amount::float8, c.status, c.manual_approval, c.release_at,
              o.id::text AS order_id, o.number AS order_number, o.status::text AS order_status
         FROM commissions c JOIN orders o ON o.id = c.order_id WHERE c.id = $1 FOR UPDATE OF c`,
      [id],
      db,
    );
  },

  async markApproved(id: string, approvedBy: string | null, db: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'commission.mark_approved',
      `UPDATE commissions SET status = 'approved', decided_at = coalesce(decided_at, now()), approved_by = $2
        WHERE id = $1 AND status = 'pending' RETURNING id::text`,
      [id, approvedBy],
      db,
    );
    return rows.length === 1;
  },

  /** pending / approved → cancelled with a reason (the database refuses a paid one). */
  async cancelOne(id: string, reason: string, db: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'commission.cancel_one',
      `UPDATE commissions SET status = 'cancelled', decided_at = coalesce(decided_at, now()), cancel_reason = $2
        WHERE id = $1 AND status IN ('pending', 'approved') RETURNING id::text`,
      [id, reason.slice(0, 300)],
      db,
    );
    return rows.length === 1;
  },

  // ───────── the affiliate's own reports (every query carries the user id) ─────────

  async pageForAffiliate(userId: string, f: CommissionFilter, limit: number, offset: number, db?: Queryable) {
    const w = filterSql(f, 2);
    const rows = await query<AffiliateCommissionRow>(
      'commission.affiliate_page',
      `SELECT c.id::text, c.level, c.status, c.base_amount::float8, c.amount::float8, c.hold_days, c.created_at, c.release_at, c.paid_at,
              coalesce(c.rule_kind, r.kind) AS rule_kind, coalesce(c.rule_value, r.value)::float8 AS rule_value
         FROM commissions c LEFT JOIN commission_rules r ON r.id = c.rule_id
        WHERE c.affiliate_user_id = $1${w.sql} ORDER BY c.id DESC LIMIT $${w.args.length + 2} OFFSET $${w.args.length + 3}`,
      [userId, ...w.args, limit, offset],
      db,
    );
    const n = await queryOne<{ n: number; total: number }>(
      'commission.affiliate_count',
      `SELECT count(*)::int AS n, coalesce(sum(c.amount) FILTER (WHERE c.status <> 'cancelled'), 0)::float8 AS total
         FROM commissions c WHERE c.affiliate_user_id = $1${w.sql}`,
      [userId, ...w.args],
      db,
    );
    return { rows, total: n?.n ?? 0, sumOfFilter: n?.total ?? 0 };
  },

  /** up to `limit` rows for the CSV (the same filters) */
  async exportForAffiliate(userId: string, f: CommissionFilter, limit: number, db?: Queryable) {
    const w = filterSql(f, 2);
    return query<AffiliateCommissionRow>(
      'commission.affiliate_export',
      `SELECT c.id::text, c.level, c.status, c.base_amount::float8, c.amount::float8, c.hold_days, c.created_at, c.release_at, c.paid_at,
              coalesce(c.rule_kind, r.kind) AS rule_kind, coalesce(c.rule_value, r.value)::float8 AS rule_value
         FROM commissions c LEFT JOIN commission_rules r ON r.id = c.rule_id
        WHERE c.affiliate_user_id = $1${w.sql} ORDER BY c.id DESC LIMIT $${w.args.length + 2}`,
      [userId, ...w.args, limit],
      db,
    );
  },

  async totalsForAffiliate(userId: string, db?: Queryable) {
    const r = await queryOne<{ pending: number; paid: number; total: number; n: number }>(
      'commission.affiliate_totals',
      `SELECT coalesce(sum(amount) FILTER (WHERE status IN ('pending', 'approved')), 0)::float8 AS pending,
              coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)::float8 AS paid,
              coalesce(sum(amount) FILTER (WHERE status <> 'cancelled'), 0)::float8 AS total,
              count(*)::int AS n
         FROM commissions WHERE affiliate_user_id = $1`,
      [userId],
      db,
    );
    return r ?? { pending: 0, paid: 0, total: 0, n: 0 };
  },

  /** per Tehran calendar day since `since` (the month grouping, in Persian months, is done by the pure report helper) */
  async dailyForAffiliate(userId: string, since: Date, db?: Queryable) {
    return query<{ day: string; total: number; paid: number }>(
      'commission.affiliate_daily',
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD') AS day,
              coalesce(sum(amount) FILTER (WHERE status <> 'cancelled'), 0)::float8 AS total,
              coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)::float8 AS paid
         FROM commissions WHERE affiliate_user_id = $1 AND created_at >= $2 GROUP BY 1 ORDER BY 1`,
      [userId, since],
      db,
    );
  },

  // ───────── the people the affiliate brought (privacy: no address, no order details, no whole number) ─────────

  /** The people this affiliate referred directly (one level), newest first. */
  async networkPage(userId: string, limit: number, offset: number, db?: Queryable) {
    return query<NetworkRow>(
      'commission.network_page',
      `SELECT r.buyer_user_id::text AS buyer_id, nullif(split_part(coalesce(u.full_name, ''), ' ', 1), '') AS first_name,
              right(u.phone, 4) AS phone_last4, u.created_at AS joined_at,
              (SELECT count(*)::int FROM orders o WHERE o.user_id = r.buyer_user_id AND o.paid_at IS NOT NULL) AS orders,
              coalesce((SELECT sum(c.amount) FILTER (WHERE c.status <> 'cancelled') FROM commissions c
                         WHERE c.affiliate_user_id = r.referrer_user_id
                           AND c.order_id IN (SELECT o.id FROM orders o WHERE o.user_id = r.buyer_user_id)), 0)::float8 AS commission
         FROM affiliate_referrals r JOIN users u ON u.id = r.buyer_user_id
        WHERE r.referrer_user_id = $1
        ORDER BY u.created_at DESC, u.id LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
      db,
    );
  },

  /** how many people this affiliate referred */
  async networkCount(userId: string, db?: Queryable): Promise<number> {
    const r = await queryOne<{ n: number }>(
      'commission.network_count',
      'SELECT count(*)::int AS n FROM affiliate_referrals WHERE referrer_user_id = $1',
      [userId],
      db,
    );
    return r?.n ?? 0;
  },

  /**
   * One referred person, only when THIS affiliate referred them (the pair is the key: another affiliate's person, or any other id,
   * finds nothing). Privacy: a first name and the last four digits.
   */
  async referredPerson(affiliateId: string, buyerId: string, db?: Queryable) {
    return queryOne<{ first_name: string | null; phone_last4: string; joined_at: Date }>(
      'commission.referred_person',
      `SELECT nullif(split_part(coalesce(u.full_name, ''), ' ', 1), '') AS first_name, right(u.phone, 4) AS phone_last4, u.created_at AS joined_at
         FROM affiliate_referrals r JOIN users u ON u.id = r.buyer_user_id
        WHERE r.referrer_user_id = $1 AND r.buyer_user_id = $2`,
      [affiliateId, buyerId],
      db,
    );
  },

  /**
   * The paid orders of one referred person with the commission this affiliate got for each: the order's goods total (the base the
   * commission was computed on), the rule's percent or fixed amount as it was, the commission and its status. No item, no address.
   */
  async personOrders(affiliateId: string, buyerId: string, limit: number, db?: Queryable) {
    return query<PersonOrderRow>(
      'commission.person_orders',
      `SELECT o.number AS order_number, o.paid_at, o.status::text AS order_status, o.items_total::float8 AS items_total,
              c.base_amount::float8 AS base_amount, c.amount::float8 AS commission, c.status AS commission_status,
              coalesce(c.rule_kind, r.kind) AS rule_kind, coalesce(c.rule_value, r.value)::float8 AS rule_value
         FROM orders o
         JOIN affiliate_referrals ref ON ref.buyer_user_id = o.user_id AND ref.referrer_user_id = $1
         LEFT JOIN commissions c ON c.order_id = o.id AND c.affiliate_user_id = $1
         LEFT JOIN commission_rules r ON r.id = c.rule_id
        WHERE o.user_id = $2 AND o.paid_at IS NOT NULL
        ORDER BY o.paid_at DESC, o.id DESC LIMIT $3`,
      [affiliateId, buyerId, limit],
      db,
    );
  },

  // ───────── who may refer whom (one level) ─────────

  /** The code's owner and what disqualifies the code (not an affiliate, owner is referred themselves). Null = no such code. */
  async referrerFacts(code: string, db?: Queryable) {
    return queryOne<{ referrer_id: string; is_affiliate: boolean; has_referrer: boolean }>(
      'commission.referrer_facts',
      `SELECT ac.user_id::text AS referrer_id,
              EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ac.user_id AND ur.role = 'affiliate') AS is_affiliate,
              EXISTS (SELECT 1 FROM affiliate_referrals r WHERE r.buyer_user_id = ac.user_id) AS has_referrer
         FROM affiliate_codes ac WHERE ac.code = $1`,
      [code],
      db,
    );
  },

  /** What the rules ask about the person being referred. */
  async userFacts(userId: string, db?: Queryable) {
    const r = await queryOne<{ has_referrer: boolean; is_affiliate: boolean; has_paid_order: boolean }>(
      'commission.user_facts',
      `SELECT EXISTS (SELECT 1 FROM affiliate_referrals WHERE buyer_user_id = $1) AS has_referrer,
              EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'affiliate') AS is_affiliate,
              EXISTS (SELECT 1 FROM orders WHERE user_id = $1 AND paid_at IS NOT NULL) AS has_paid_order`,
      [userId],
      db,
    );
    return r ?? { has_referrer: false, is_affiliate: false, has_paid_order: false };
  },

  /** Which of these users have a referrer (the admin's applications list warns about them). */
  async referredAmong(userIds: readonly string[], db?: Queryable): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await query<{ id: string }>(
      'commission.referred_among',
      'SELECT buyer_user_id::text AS id FROM affiliate_referrals WHERE buyer_user_id = ANY($1::bigint[])',
      [userIds],
      db,
    );
    return new Set(rows.map((r) => r.id));
  },

  /** The code this user was referred with (shown locked), or null. */
  async referredByCode(userId: string, db?: Queryable): Promise<string | null> {
    const r = await queryOne<{ code: string }>(
      'commission.referred_by_code',
      'SELECT code FROM affiliate_referrals WHERE buyer_user_id = $1',
      [userId],
      db,
    );
    return r?.code ?? null;
  },

  /** Affiliates who were themselves referred (a one-level programme should have none; their code brings no new referrals). */
  async referredAffiliateCount(db?: Queryable): Promise<number> {
    const r = await queryOne<{ n: number }>(
      'commission.referred_affiliates',
      `SELECT count(*)::int AS n FROM affiliate_referrals r
        WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = r.buyer_user_id AND ur.role = 'affiliate')`,
      [],
      db,
    );
    return r?.n ?? 0;
  },

  // ───────── admin ─────────

  async adminPage(
    f: { status: CommissionStatus | null; phone: string | null },
    limit: number,
    offset: number,
    db?: Queryable,
  ) {
    const where = `($1::text IS NULL OR c.status::text = $1::text) AND ($2::text IS NULL OR u.phone = $2::text)`;
    const rows = await query<AdminCommissionRow>(
      'commission.admin_page',
      `SELECT c.id::text, o.number AS order_number, o.status::text AS order_status, c.affiliate_user_id::text, u.phone AS affiliate_phone,
              c.level, c.status, c.manual_approval, c.base_amount::float8, c.amount::float8, c.created_at, c.release_at, c.paid_at, c.cancel_reason
         FROM commissions c JOIN orders o ON o.id = c.order_id JOIN users u ON u.id = c.affiliate_user_id
        WHERE ${where} ORDER BY c.id DESC LIMIT $3 OFFSET $4`,
      [f.status, f.phone, limit, offset],
      db,
    );
    const s = await queryOne<{ n: number; total: number }>(
      'commission.admin_sum',
      `SELECT count(*)::int AS n, coalesce(sum(c.amount), 0)::float8 AS total
         FROM commissions c JOIN users u ON u.id = c.affiliate_user_id WHERE ${where}`,
      [f.status, f.phone],
      db,
    );
    return { rows, total: s?.n ?? 0, sum: s?.total ?? 0 };
  },

  async adminCounts(db?: Queryable): Promise<Record<CommissionStatus, number>> {
    const rows = await query<{ status: CommissionStatus; n: number }>(
      'commission.admin_counts',
      'SELECT status, count(*)::int AS n FROM commissions GROUP BY status',
      [],
      db,
    );
    const out: Record<CommissionStatus, number> = { pending: 0, approved: 0, paid: 0, cancelled: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  },

  /** commissions of a manual rule waiting for an admin: their order was sent and they are still pending */
  async awaitingManualCount(db?: Queryable): Promise<number> {
    const r = await queryOne<{ n: number }>(
      'commission.awaiting_manual',
      `SELECT count(*)::int AS n FROM commissions c JOIN orders o ON o.id = c.order_id
        WHERE c.status = 'pending' AND c.manual_approval AND o.status = 'sent'`,
      [],
      db,
    );
    return r?.n ?? 0;
  },
};
