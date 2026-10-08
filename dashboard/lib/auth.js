import 'server-only';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, verifySession } from './session';

export function checkCredentials(user, password) {
  const [scheme, saltHex, hashHex] = String(process.env.DASHBOARD_PASSWORD_HASH || '').split(':');
  const expectedUser = process.env.DASHBOARD_USER || '';
  if (scheme !== 'scrypt' || !saltHex || !hashHex || !expectedUser) throw new Error('DASHBOARD_USER / DASHBOARD_PASSWORD_HASH not configured');
  const want = Buffer.from(hashHex, 'hex');
  const got = scryptSync(String(password), Buffer.from(saltHex, 'hex'), want.length);
  const userOk = user.length === expectedUser.length && timingSafeEqual(Buffer.from(user), Buffer.from(expectedUser));
  return timingSafeEqual(got, want) && userOk;
}

// Brute-force brake: 5 failed attempts per client per 15 minutes (single process, in memory).
const failures = new Map();
const WINDOW = 15 * 60_000;
export function tooManyAttempts(ip) {
  const list = (failures.get(ip) || []).filter((t) => Date.now() - t < WINDOW);
  failures.set(ip, list);
  return list.length >= 5;
}
export const recordFailure = (ip) => failures.set(ip, [...(failures.get(ip) || []), Date.now()]);

/** Defense in depth: every page and server action calls this even though proxy.js already gates requests. */
export async function requireUser() {
  const user = await verifySession((await cookies()).get(COOKIE)?.value);
  if (!user) redirect('/login');
  return user;
}
