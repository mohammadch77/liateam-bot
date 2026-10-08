'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkCredentials, tooManyAttempts, recordFailure } from '@/lib/auth';
import { COOKIE, signSession, cookieOptions } from '@/lib/session';

async function clientIp() {
  const h = await headers();
  // Behind nginx: the last hop it appended. Direct: no header -> one shared bucket.
  return (h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',').pop() || 'direct').trim();
}

export async function login(_prev, form) {
  const ip = await clientIp();
  if (tooManyAttempts(ip)) return { error: 'تلاش‌های ناموفق زیاد بود. ۱۵ دقیقه‌ی دیگر دوباره امتحان کنید.' };
  const user = String(form.get('user') || '');
  let ok = false;
  try {
    ok = checkCredentials(user, String(form.get('password') || ''));
  } catch (e) {
    console.error(e.message);
    return { error: 'ورود پیکربندی نشده است (DASHBOARD_USER / DASHBOARD_PASSWORD_HASH در .env).' };
  }
  if (!ok) {
    recordFailure(ip);
    return { error: 'نام کاربری یا رمز اشتباه است.', user };
  }
  (await cookies()).set(COOKIE, await signSession(user), cookieOptions());
  redirect('/');
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect('/login');
}
