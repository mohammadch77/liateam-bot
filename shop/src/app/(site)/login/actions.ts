'use server';

import { redirect } from 'next/navigation';
import { runAction, type ActionResult } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { writeSessionCookie } from '@/server/auth/cookie';
import { safeNextPath } from '@/server/auth/guards';
import { authService, type OtpRequested } from '@/server/services/auth.service';

export type RequestCodeState = ActionResult<
  Pick<OtpRequested, 'phone' | 'masked' | 'resendAfterSeconds'>
> | null;
export type VerifyCodeState = ActionResult<null> | null;

/** Step 1: phone → SMS code. */
export async function requestCodeAction(_prev: RequestCodeState, form: FormData): Promise<RequestCodeState> {
  return runAction('auth.request_code', async () => {
    const r = await authService.requestOtp(String(form.get('phone') ?? ''), await requestMeta());
    return { phone: r.phone, masked: r.masked, resendAfterSeconds: r.resendAfterSeconds };
  });
}

/** Step 2: code → session cookie → back to where the user came from. */
export async function verifyCodeAction(_prev: VerifyCodeState, form: FormData): Promise<VerifyCodeState> {
  const result = await runAction('auth.verify_code', async () => {
    const s = await authService.verifyOtp(
      String(form.get('phone') ?? ''),
      String(form.get('code') ?? ''),
      await requestMeta(),
    );
    await writeSessionCookie(s.token, s.expiresAt);
    return null;
  });
  if (!result.ok) return result;
  // redirect() throws a control-flow signal, so it stays outside runAction's try/catch.
  redirect(safeNextPath(String(form.get('next') ?? '')));
}
