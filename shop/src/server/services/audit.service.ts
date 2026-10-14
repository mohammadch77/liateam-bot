import 'server-only';
import { authorize } from '@/server/auth/guards';
import { auditRepository } from '@/server/repositories/audit.repository';

export const auditService = {
  /** Recent security events; admins only (checked here too, not just by the page). */
  async recent(limit = 20) {
    await authorize('admin');
    return auditRepository.recent(Math.min(Math.max(limit, 1), 200));
  },
};
