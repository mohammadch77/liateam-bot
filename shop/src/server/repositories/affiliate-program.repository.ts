import 'server-only';
import {
  DEFAULT_ACTIVE_MIN_TOMAN,
  DEFAULT_AFFILIATE_TIERS,
  DEFAULT_JOIN_MIN_TOMAN,
  sanitizeTiers,
  type AffiliateTier,
} from '@/lib/affiliate/tiers';
import { query, queryOne, type Queryable } from '@/lib/db';

export type AffiliateGlobalConfigRow = {
  join_min_monthly_toman: number;
  active_min_monthly_toman: number;
  tiers: AffiliateTier[];
  updated_at: Date | null;
};

export type AffiliateUserOverrideRow = {
  user_id: string;
  join_min_monthly_toman: number | null;
  active_min_monthly_toman: number | null;
  tiers: AffiliateTier[] | null;
  note: string | null;
  updated_at: Date;
};

export type ManagedAffiliateUserRow = {
  user_id: string;
  phone: string;
  full_name: string | null;
  is_affiliate: boolean;
  join_min_monthly_toman: number | null;
  active_min_monthly_toman: number | null;
  tiers: AffiliateTier[] | null;
  note: string | null;
  personal_30d: number;
  referred_sales_30d: number;
};

const PAID_STATUS_EXCL = `('canceled', 'refunded', 'pending_payment')`;

export const affiliateProgramRepository = {
  async getGlobal(db?: Queryable): Promise<AffiliateGlobalConfigRow> {
    const row = await queryOne<{
      join_min_monthly_toman: string;
      active_min_monthly_toman: string;
      tiers: unknown;
      updated_at: Date;
    }>(
      'affiliate_program.get_global',
      `SELECT join_min_monthly_toman::text, active_min_monthly_toman::text, tiers, updated_at
         FROM affiliate_global_config WHERE id = 1`,
      [],
      db,
    );
    if (!row) {
      return {
        join_min_monthly_toman: DEFAULT_JOIN_MIN_TOMAN,
        active_min_monthly_toman: DEFAULT_ACTIVE_MIN_TOMAN,
        tiers: [...DEFAULT_AFFILIATE_TIERS],
        updated_at: null,
      };
    }
    return {
      join_min_monthly_toman: Number(row.join_min_monthly_toman) || 0,
      active_min_monthly_toman: Number(row.active_min_monthly_toman) || 0,
      tiers: sanitizeTiers(row.tiers),
      updated_at: row.updated_at,
    };
  },

  async saveGlobal(
    v: { joinMinMonthlyToman: number; activeMinMonthlyToman: number; tiers: AffiliateTier[] },
    adminId: string,
    db?: Queryable,
  ): Promise<void> {
    await query(
      'affiliate_program.save_global',
      `INSERT INTO affiliate_global_config (id, join_min_monthly_toman, active_min_monthly_toman, tiers, updated_by)
       VALUES (1, $1, $2, $3::jsonb, $4)
       ON CONFLICT (id) DO UPDATE
       SET join_min_monthly_toman = EXCLUDED.join_min_monthly_toman,
           active_min_monthly_toman = EXCLUDED.active_min_monthly_toman,
           tiers = EXCLUDED.tiers,
           updated_by = EXCLUDED.updated_by`,
      [v.joinMinMonthlyToman, v.activeMinMonthlyToman, JSON.stringify(v.tiers), adminId],
      db,
    );
  },

  async getOverride(userId: string, db?: Queryable): Promise<AffiliateUserOverrideRow | null> {
    const row = await queryOne<{
      user_id: string;
      join_min_monthly_toman: string | null;
      active_min_monthly_toman: string | null;
      tiers: unknown;
      note: string | null;
      updated_at: Date;
    }>(
      'affiliate_program.get_override',
      `SELECT user_id::text, join_min_monthly_toman::text, active_min_monthly_toman::text, tiers, note, updated_at
         FROM affiliate_user_overrides WHERE user_id = $1`,
      [userId],
      db,
    );
    if (!row) return null;
    return {
      user_id: row.user_id,
      join_min_monthly_toman: row.join_min_monthly_toman !== null ? Number(row.join_min_monthly_toman) : null,
      active_min_monthly_toman: row.active_min_monthly_toman !== null ? Number(row.active_min_monthly_toman) : null,
      tiers: row.tiers !== null ? sanitizeTiers(row.tiers) : null,
      note: row.note,
      updated_at: row.updated_at,
    };
  },

  async saveOverride(
    userId: string,
    v: {
      joinMinMonthlyToman: number | null;
      activeMinMonthlyToman: number | null;
      tiers: AffiliateTier[] | null;
      note: string | null;
    },
    adminId: string,
    db?: Queryable,
  ): Promise<void> {
    if (
      v.joinMinMonthlyToman === null &&
      v.activeMinMonthlyToman === null &&
      v.tiers === null &&
      !v.note
    ) {
      await query('affiliate_program.delete_override', `DELETE FROM affiliate_user_overrides WHERE user_id = $1`, [userId], db);
      return;
    }
    await query(
      'affiliate_program.save_override',
      `INSERT INTO affiliate_user_overrides
         (user_id, join_min_monthly_toman, active_min_monthly_toman, tiers, note, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
       SET join_min_monthly_toman = EXCLUDED.join_min_monthly_toman,
           active_min_monthly_toman = EXCLUDED.active_min_monthly_toman,
           tiers = EXCLUDED.tiers,
           note = EXCLUDED.note,
           updated_by = EXCLUDED.updated_by`,
      [
        userId,
        v.joinMinMonthlyToman,
        v.activeMinMonthlyToman,
        v.tiers ? JSON.stringify(v.tiers) : null,
        v.note,
        adminId,
      ],
      db,
    );
  },

  async deleteOverride(userId: string, db?: Queryable): Promise<void> {
    await query('affiliate_program.delete_override', `DELETE FROM affiliate_user_overrides WHERE user_id = $1`, [userId], db);
  },

  async monthlyPersonalPurchase(userId: string, db?: Queryable): Promise<number> {
    const row = await queryOne<{ total: string }>(
      'affiliate_program.personal_30d',
      `SELECT COALESCE(SUM(items_total), 0)::text AS total
         FROM orders
        WHERE user_id = $1
          AND paid_at IS NOT NULL
          AND paid_at >= now() - interval '30 days'
          AND status NOT IN ${PAID_STATUS_EXCL}`,
      [userId],
      db,
    );
    return Number(row?.total ?? 0);
  },

  async monthlyReferredSales(affiliateUserId: string, db?: Queryable): Promise<number> {
    const row = await queryOne<{ total: string }>(
      'affiliate_program.referred_sales_30d',
      `SELECT COALESCE(SUM(o.items_total), 0)::text AS total
         FROM orders o
         JOIN affiliate_referrals r ON r.buyer_user_id = o.user_id
        WHERE r.referrer_user_id = $1
          AND o.paid_at IS NOT NULL
          AND o.paid_at >= now() - interval '30 days'
          AND o.status NOT IN ${PAID_STATUS_EXCL}`,
      [affiliateUserId],
      db,
    );
    return Number(row?.total ?? 0);
  },

  /** All active affiliates + any user with a custom override, with 30-day personal & referred totals. */
  async listManagedUsers(limit = 100): Promise<ManagedAffiliateUserRow[]> {
    const rows = await query<{
      user_id: string;
      phone: string;
      full_name: string | null;
      is_affiliate: boolean;
      join_min_monthly_toman: string | null;
      active_min_monthly_toman: string | null;
      tiers: unknown;
      note: string | null;
      personal_30d: string;
      referred_sales_30d: string;
    }>(
      'affiliate_program.list_managed_users',
      `SELECT u.id::text AS user_id,
              u.phone,
              u.full_name,
              EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'affiliate') AS is_affiliate,
              ov.join_min_monthly_toman::text,
              ov.active_min_monthly_toman::text,
              ov.tiers,
              ov.note,
              COALESCE((
                SELECT SUM(o.items_total) FROM orders o
                 WHERE o.user_id = u.id AND o.paid_at IS NOT NULL
                   AND o.paid_at >= now() - interval '30 days'
                   AND o.status NOT IN ${PAID_STATUS_EXCL}
              ), 0)::text AS personal_30d,
              COALESCE((
                SELECT SUM(o.items_total) FROM orders o
                  JOIN affiliate_referrals r ON r.buyer_user_id = o.user_id
                 WHERE r.referrer_user_id = u.id AND o.paid_at IS NOT NULL
                   AND o.paid_at >= now() - interval '30 days'
                   AND o.status NOT IN ${PAID_STATUS_EXCL}
              ), 0)::text AS referred_sales_30d
         FROM users u
         LEFT JOIN affiliate_user_overrides ov ON ov.user_id = u.id
        WHERE u.deleted_at IS NULL
          AND (
            ov.user_id IS NOT NULL
            OR EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'affiliate')
          )
        ORDER BY (ov.user_id IS NOT NULL) DESC, is_affiliate DESC, u.id DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      user_id: r.user_id,
      phone: r.phone,
      full_name: r.full_name,
      is_affiliate: r.is_affiliate,
      join_min_monthly_toman: r.join_min_monthly_toman !== null ? Number(r.join_min_monthly_toman) : null,
      active_min_monthly_toman: r.active_min_monthly_toman !== null ? Number(r.active_min_monthly_toman) : null,
      tiers: r.tiers !== null ? sanitizeTiers(r.tiers) : null,
      note: r.note,
      personal_30d: Number(r.personal_30d) || 0,
      referred_sales_30d: Number(r.referred_sales_30d) || 0,
    }));
  },
};
