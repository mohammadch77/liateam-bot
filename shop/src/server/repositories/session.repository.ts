import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import type { UserRole, UserStatus } from './user.repository';

export type SessionUserRow = {
  session_id: string;
  expires_at: Date;
  user_id: string;
  phone: string;
  full_name: string | null;
  status: UserStatus;
  roles: UserRole[];
};

export const sessionRepository = {
  async create(
    db: Queryable,
    v: { userId: string; tokenHash: string; ttlDays: number; userAgent: string | null; ip: string | null },
  ): Promise<{ id: string; expires_at: Date }> {
    const row = await queryOne<{ id: string; expires_at: Date }>(
      'session.create',
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)
       RETURNING id::text, expires_at`,
      [v.userId, v.tokenHash, v.ttlDays, v.userAgent, v.ip],
      db,
    );
    if (!row) throw new Error('session insert returned nothing');
    return row;
  },

  /** The live session with its user and roles; null if unknown, revoked, expired or the user was deleted. */
  async findActive(tokenHash: string): Promise<SessionUserRow | null> {
    return queryOne<SessionUserRow>(
      'session.find_active',
      `SELECT s.id::text AS session_id, s.expires_at,
              u.id::text AS user_id, u.phone, u.full_name, u.status,
              COALESCE(array_agg(r.role::text ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
         FROM sessions s
         JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
         LEFT JOIN user_roles r ON r.user_id = u.id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        GROUP BY s.id, u.id`,
      [tokenHash],
    );
  },

  async revoke(tokenHash: string): Promise<{ user_id: string } | null> {
    return queryOne<{ user_id: string }>(
      'session.revoke',
      `UPDATE sessions SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING user_id::text`,
      [tokenHash],
    );
  },

  /** Sign out everywhere (e.g. after a role is removed or the account is suspended). */
  async revokeAllForUser(db: Queryable, userId: string): Promise<number> {
    const rows = await query(
      'session.revoke_all',
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
      [userId],
      db,
    );
    return rows.length;
  },
};
