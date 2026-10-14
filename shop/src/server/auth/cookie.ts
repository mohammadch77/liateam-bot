import 'server-only';
import { cookies } from 'next/headers';
import { getConfig } from '@/lib/config';

/**
 * Session cookie. With HTTPS it uses the __Host- prefix: the browser then enforces Secure, Path=/ and no Domain,
 * so a sibling subdomain can never set or read it. httpOnly keeps it away from JavaScript (XSS cannot steal it);
 * SameSite=Lax stops it riding along on cross-site POSTs.
 */
function cookieName(): string {
  return getConfig().COOKIE_SECURE ? '__Host-sid' : 'sid';
}

export async function readSessionCookie(): Promise<string | null> {
  const value = (await cookies()).get(cookieName())?.value;
  // 32 random bytes in base64url = 43 chars; anything else is not ours.
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export async function writeSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(cookieName(), '', {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
