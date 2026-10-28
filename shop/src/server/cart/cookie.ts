import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { getConfig } from '@/lib/config';

/**
 * The guest cart's cookie: 32 random bytes (base64url, 43 characters) in an httpOnly cookie; the database keeps only a
 * hash, so a copy of the table cannot open anybody's cart. With HTTPS the __Host- prefix is used like the session cookie.
 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const cookieName = () => (getConfig().COOKIE_SECURE ? '__Host-cart' : 'cart');

export const hashCartToken = (token: string): string =>
  createHash('sha256').update(`cart:${token}`).digest('hex');

export async function readCartToken(): Promise<string | null> {
  const value = (await cookies()).get(cookieName())?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

/** A new token, set as the cookie (only from an action or route: cookies cannot be written while rendering). */
export async function issueCartToken(): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return token;
}

export async function clearCartToken(): Promise<void> {
  (await cookies()).set(cookieName(), '', {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
