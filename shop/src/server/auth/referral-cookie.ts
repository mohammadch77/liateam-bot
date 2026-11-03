import 'server-only';
import { cookies } from 'next/headers';
import { getConfig } from '@/lib/config';

/**
 * The referral link's memory: /r/<code> stores the code here for thirty days, and the first sign-up on this browser attaches the
 * referrer (auth.service). A code is 4-20 lowercase letters / digits; anything else in the cookie is ignored. The cookie holds only
 * the code (public: it is in the link) and is cleared once it has been used.
 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const cookieName = () => (getConfig().COOKIE_SECURE ? '__Host-ref' : 'ref');
export const REF_CODE = /^[a-z0-9]{4,20}$/;

export async function readReferralCode(): Promise<string | null> {
  const value = (await cookies()).get(cookieName())?.value;
  return value && REF_CODE.test(value) ? value : null;
}

export async function setReferralCode(code: string): Promise<void> {
  (await cookies()).set(cookieName(), code, {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearReferralCode(): Promise<void> {
  (await cookies()).set(cookieName(), '', {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
