import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE, verifySession } from './session';

/** Username of the logged-in dashboard user, or null (proxy.js already blocks /api without a session). */
export async function apiUser() {
  return verifySession((await cookies()).get(COOKIE)?.value);
}

export async function readJson(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export const unauthorized = () => Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
export const badRequest = (error = 'بدنه‌ی درخواست باید JSON باشد') => Response.json({ ok: false, error }, { status: 400 });
