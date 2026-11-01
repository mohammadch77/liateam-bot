import 'server-only';
import { forbidden, redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import type { UserRole } from '@/server/repositories/user.repository';
import { settingsRead } from '@/server/services/settings-read.service';
import { getCurrentUser, hasRole, type CurrentUser } from '@/server/services/session.service';

/**
 * Access control for pages, layouts and actions. Checks run on the server for every request: hiding a link or a
 * form is never the security boundary.
 *
 * The admin role has a SHORTER session than a customer's: the panel asks for the code again once the sign-in is older
 * than the «security.admin_session_hours» setting (default 8). It counts from the sign-in, so it is the same for pages
 * and for actions, and a stolen cookie of an old session opens nothing in the panel.
 */

/** Only same-site paths are allowed as a post-login target (no open redirect to another domain). */
export function safeNextPath(next: string | null | undefined, fallback = '/account'): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

/** Has this user's sign-in outlived the admin panel's session length? (a non-admin is never "expired" here) */
async function adminSessionExpired(user: CurrentUser): Promise<boolean> {
  if (!user.roles.includes('admin')) return false;
  const hours = await settingsRead.get('security.admin_session_hours');
  return Date.now() - user.sessionCreatedAt.getTime() > hours * 3_600_000;
}

/** Pages: signed-in user or a redirect to the login page that comes back here afterwards. */
export async function requireUser(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(returnTo))}`);
  return user;
}

/** Pages: the role (or admin), otherwise HTTP 403 with the forbidden page. The admin panel also needs a recent sign-in. */
export async function requireRole(role: UserRole, returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!hasRole(user, role)) forbidden();
  if (role === 'admin' && (await adminSessionExpired(user)))
    redirect(`/login?next=${encodeURIComponent(safeNextPath(returnTo))}&expired=1`);
  return user;
}

/** Route handlers and actions: throws AppError UNAUTHORIZED (401) / FORBIDDEN (403). */
export async function authorize(role?: UserRole): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError('UNAUTHORIZED');
  if (role && !hasRole(user, role)) throw new AppError('FORBIDDEN');
  if (role === 'admin' && (await adminSessionExpired(user)))
    throw new AppError('UNAUTHORIZED', { message: 'نشست مدیریت منقضی شده است. دوباره وارد شوید.' });
  return user;
}
