import 'server-only';
import { query, type Queryable } from '@/lib/db';

export type AuditEntry = {
  actorUserId: string | null;
  /** dotted lowercase, e.g. auth.login, role.grant */
  action: string;
  entityType: string;
  entityId: string | null;
  meta?: Record<string, unknown>;
  ip: string | null;
};

export const auditRepository = {
  /** Append-only (UPDATE/DELETE are blocked by a trigger). */
  async record(e: AuditEntry, db?: Queryable): Promise<void> {
    await query(
      'audit.record',
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta, ip)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [e.actorUserId, e.action, e.entityType, e.entityId, JSON.stringify(e.meta ?? {}), e.ip],
      db,
    );
  },

  async recent(limit: number) {
    return query<{
      id: string;
      actor_user_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      meta: Record<string, unknown>;
      created_at: Date;
    }>(
      'audit.recent',
      `SELECT id::text, actor_user_id::text, action, entity_type, entity_id, meta, created_at
         FROM audit_log ORDER BY id DESC LIMIT $1`,
      [limit],
    );
  },
};
