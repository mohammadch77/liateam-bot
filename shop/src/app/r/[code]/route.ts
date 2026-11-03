import { NextResponse } from 'next/server';
import { REF_CODE, setReferralCode } from '@/server/auth/referral-cookie';
import { commissionRepository } from '@/server/repositories/commission.repository';

export const dynamic = 'force-dynamic';

/**
 * The referral link: /r/<code>. A code that belongs to an affiliate is remembered in a cookie (thirty days) and the visitor goes to the
 * home page; an unknown code does the same without any cookie, so the link never says whether a code exists. The referrer is attached
 * only when the visitor later SIGNS UP (a first sign-up), never to an account that already exists.
 */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const home = new URL('/', request.url);
  try {
    if (REF_CODE.test(code) && (await commissionRepository.userByCode(code))) await setReferralCode(code);
  } catch {
    // a database hiccup must not break a link click
  }
  return NextResponse.redirect(home, 303);
}
