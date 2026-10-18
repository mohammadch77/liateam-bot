import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

/** «همکاری در فروش» applications (shop schema, table affiliate_applications). */
export type AffiliateStatus = 'pending' | 'approved' | 'rejected';
export type ChannelType = 'instagram' | 'telegram' | 'store' | 'website' | 'other';
export type Followers = 'lt1k' | '1k-10k' | '10k-50k' | '50k-100k' | 'gt100k';
export type AffiliateSource = 'home' | 'footer' | 'account' | 'direct';

export type AffiliateApplicationRow = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  province: string;
  city: string;
  channel_type: ChannelType;
  channel_url: string;
  followers: Followers | null;
  description: string;
  source: AffiliateSource;
  status: AffiliateStatus;
  created_at: Date;
  decided_at: Date | null;
  reject_reason: string | null;
};

const COLS = `id::text, user_id::text, full_name, phone, province, city, channel_type, channel_url, followers,
  description, source, status, created_at, decided_at, reject_reason`;

export type NewAffiliateApplication = {
  userId: string;
  fullName: string;
  phone: string;
  province: string;
  city: string;
  channelType: ChannelType;
  channelUrl: string;
  followers: Followers | null;
  description: string;
  source: AffiliateSource;
  ip: string | null;
};

export const affiliateRepository = {
  async insert(a: NewAffiliateApplication, db?: Queryable): Promise<{ id: string }> {
    const row = await queryOne<{ id: string }>(
      'affiliate.insert',
      `INSERT INTO affiliate_applications
         (user_id, full_name, phone, province, city, channel_type, channel_url, followers, description, source, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::text`,
      [
        a.userId,
        a.fullName,
        a.phone,
        a.province,
        a.city,
        a.channelType,
        a.channelUrl,
        a.followers,
        a.description,
        a.source,
        a.ip,
      ],
      db,
    );
    return row!;
  },

  /** The user's most recent application (its status page), or null. */
  async latestFor(userId: string, db?: Queryable): Promise<AffiliateApplicationRow | null> {
    return queryOne<AffiliateApplicationRow>(
      'affiliate.latest_for',
      `SELECT ${COLS} FROM affiliate_applications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [userId],
      db,
    );
  },

  /** Rate limiting: applications sent in the last `seconds` by this user and from this IP. */
  async recent(userId: string, ip: string | null, seconds: number, db?: Queryable) {
    const row = await queryOne<{ by_user: number; by_ip: number }>(
      'affiliate.recent',
      `SELECT count(*) FILTER (WHERE user_id = $1)::int AS by_user,
              count(*) FILTER (WHERE $2::inet IS NOT NULL AND ip = $2::inet)::int AS by_ip
         FROM affiliate_applications
        WHERE created_at > now() - make_interval(secs => $3) AND (user_id = $1 OR ip = $2::inet)`,
      [userId, ip, seconds],
      db,
    );
    return { byUser: row?.by_user ?? 0, byIp: row?.by_ip ?? 0 };
  },

  /** Admin list: one status, oldest first for the pending queue, newest first otherwise. */
  async list(status: AffiliateStatus, limit: number): Promise<AffiliateApplicationRow[]> {
    return query<AffiliateApplicationRow>(
      'affiliate.list',
      `SELECT ${COLS} FROM affiliate_applications WHERE status = $1
        ORDER BY ${status === 'pending' ? 'created_at ASC' : 'decided_at DESC NULLS LAST'}, id LIMIT $2`,
      [status, limit],
    );
  },

  async counts(): Promise<Record<AffiliateStatus, number>> {
    const rows = await query<{ status: AffiliateStatus; n: number }>(
      'affiliate.counts',
      `SELECT status, count(*)::int AS n FROM affiliate_applications GROUP BY status`,
    );
    const out = { pending: 0, approved: 0, rejected: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  },

  /** Decides a pending application (only once: an already decided one returns null). */
  async decide(
    id: string,
    status: 'approved' | 'rejected',
    adminId: string,
    reason: string | null,
    db?: Queryable,
  ): Promise<{ id: string; user_id: string } | null> {
    return queryOne<{ id: string; user_id: string }>(
      'affiliate.decide',
      `UPDATE affiliate_applications
          SET status = $2, decided_at = now(), decided_by = $3, reject_reason = $4
        WHERE id = $1 AND status = 'pending' RETURNING id::text, user_id::text`,
      [id, status, adminId, reason],
      db,
    );
  },
};
