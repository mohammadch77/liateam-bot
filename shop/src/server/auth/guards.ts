import 'server-only';
import { forbidden, redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import type { UserRole } from '@/server/repositories/user.repository';
import { getCurrentUser, hasRole, type CurrentUser } from '@/server/services/session.service';

/**
 * Access control for pages, layouts and actions. Checks run on the server for every request: hiding a link or a
 * form is never the security boundary.
 */

/** Only same-site paths are allowed as a post-login target (no open redirect to another domain). */
export function safeNextPath(next: string | null | undefined, fallback = '/account'): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

/** Pages: signed-in user or a redirect to the login page that comes back here afterwards. */
export async function requireUser(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(returnTo))}`);
  return user;
}

/** Pages: the role (or admin), otherwise HTTP 403 with the forbidden page. */
export async function requireRole(role: UserRole, returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!hasRole(user, role)) forbidden();
  return user;
}

/** Route handlers and actions: throws AppError UNAUTHORIZED (401) / FORBIDDEN (403). */
export async function authorize(role?: UserRole): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError('UNAUTHORIZED');
  if (role && !hasRole(user, role)) throw new AppError('FORBIDDEN');
  return user;
}
