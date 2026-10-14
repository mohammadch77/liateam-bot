import 'server-only';
import { cache } from 'react';
import { readSessionCookie } from '@/server/auth/cookie';
import { sessionRepository } from '@/server/repositories/session.repository';
import type { UserRole } from '@/server/repositories/user.repository';
import { hashSessionToken } from '@/server/security/crypto';

/** What the rest of the app knows about the signed-in user. Never contains token or hash. */
export type CurrentUser = {
  id: string;
  phone: string;
  fullName: string | null;
  roles: readonly UserRole[];
  sessionExpiresAt: Date;
};

/**
 * The user behind the session cookie, or null. Cached per request (React cache), so layouts, pages and actions
 * in one render share a single database lookup. Suspended users count as signed out.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionCookie();
  if (!token) return null;
  const row = await sessionRepository.findActive(hashSessionToken(token));
  if (!row || row.status !== 'active') return null;
  return {
    id: row.user_id,
    phone: row.phone,
    fullName: row.full_name,
    roles: row.roles,
    sessionExpiresAt: row.expires_at,
  };
});

/** admin implicitly holds every role. */
export function hasRole(user: Pick<CurrentUser, 'roles'>, role: UserRole): boolean {
  return user.roles.includes(role) || user.roles.includes('admin');
}
