import 'server-only';
import { authorize } from '@/server/auth/guards';
import { auditRepository } from '@/server/repositories/audit.repository';

export const auditService = {
  /** When this admin signed in before the current session (null on a first ever sign-in). */
  async previousLogin(): Promise<{ at: Date; ip: string | null } | null> {
    const admin = await authorize('admin');
    const [, previous] = await auditRepository.logins(admin.id, 2);
    return previous ? { at: previous.created_at, ip: previous.ip } : null;
  },

  /** Recent security events; admins only (checked here too, not just by the page). */
  async recent(limit = 20) {
    await authorize('admin');
    return auditRepository.recent(Math.min(Math.max(limit, 1), 200));
  },
};
