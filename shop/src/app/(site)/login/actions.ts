'use server';

import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { writeSessionCookie } from '@/server/auth/cookie';
import { safeNextPath } from '@/server/auth/guards';
import { runAction, type ActionResult } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import {
  authService,
  type OtpRequested,
  type OtpVerifiedProof,
  type SignedIn,
} from '@/server/services/auth.service';
import { cartService } from '@/server/services/cart.service';
import { referralService } from '@/server/services/referral.service';

export type OtpRequestData = Pick<OtpRequested, 'phone' | 'masked' | 'resendAfterSeconds'>;
export type OtpRequestResult = ActionResult<OtpRequestData>;
export type OtpVerifyProofResult = ActionResult<OtpVerifiedProof>;
export type AuthActionResult = ActionResult<null>;
export type ResetCompleteResult = ActionResult<{ phone: string }>;

async function finalizeSignIn(signedIn: SignedIn): Promise<void> {
  await writeSessionCookie(signedIn.token, signedIn.expiresAt);
  try {
    await cartService.mergeGuestIntoUser(signedIn.userId);
  } catch (e) {
    logger.warn('cart.merge_failed', { err: e });
  }
}

/** Login with phone (username) + password. */
export async function loginPasswordAction(form: FormData): Promise<AuthActionResult> {
  const result = await runAction('auth.login_password', async () => {
    const s = await authService.loginWithPassword(
      String(form.get('phone') ?? ''),
      String(form.get('password') ?? ''),
      await requestMeta(),
    );
    await finalizeSignIn(s);
    return null;
  });
  if (!result.ok) return result;
  redirect(safeNextPath(String(form.get('next') ?? '')));
}

/** Login via SMS OTP — Step 1: request login code. */
export async function requestLoginOtpAction(form: FormData): Promise<OtpRequestResult> {
  return runAction('auth.request_login_otp', async () => {
    const r = await authService.requestLoginOtp(String(form.get('phone') ?? ''), await requestMeta());
    return { phone: r.phone, masked: r.masked, resendAfterSeconds: r.resendAfterSeconds };
  });
}

/** Login via SMS OTP — Step 2: verify code and sign in. */
export async function verifyLoginOtpAction(form: FormData): Promise<AuthActionResult> {
  const result = await runAction('auth.verify_login_otp', async () => {
    const s = await authService.verifyLoginOtp(
      String(form.get('phone') ?? ''),
      String(form.get('code') ?? ''),
      await requestMeta(),
    );
    await finalizeSignIn(s);
    return null;
  });
  if (!result.ok) return result;
  redirect(safeNextPath(String(form.get('next') ?? '')));
}

/** Registration — Step 1: validate optional referral code + phone, send registration OTP. */
export async function requestRegisterOtpAction(form: FormData): Promise<OtpRequestResult> {
  return runAction('auth.request_register_otp', async () => {
    const meta = await requestMeta();
    const refRaw = String(form.get('ref') ?? '');
    if (refRaw.trim()) {
      const refused = await referralService.rememberTyped(refRaw, meta.ip);
      if (refused) throw new AppError('INVALID_DATA', { message: refused });
    }
    const r = await authService.requestRegisterOtp(String(form.get('phone') ?? ''), meta);
    return { phone: r.phone, masked: r.masked, resendAfterSeconds: r.resendAfterSeconds };
  });
}

/** Registration — Step 2: verify registration OTP, return proof token for password step. */
export async function verifyRegisterOtpAction(form: FormData): Promise<OtpVerifyProofResult> {
  return runAction('auth.verify_register_otp', async () => {
    return authService.verifyRegisterOtp(
      String(form.get('phone') ?? ''),
      String(form.get('code') ?? ''),
      await requestMeta(),
    );
  });
}

/** Registration — Step 3: set password, create account, attach referral, sign in. */
export async function completeRegisterAction(form: FormData): Promise<AuthActionResult> {
  const result = await runAction('auth.complete_register', async () => {
    const s = await authService.completeRegister(
      String(form.get('proofToken') ?? ''),
      String(form.get('password') ?? ''),
      String(form.get('confirmPassword') ?? ''),
      await requestMeta(),
    );
    await finalizeSignIn(s);
    return null;
  });
  if (!result.ok) return result;
  redirect(safeNextPath(String(form.get('next') ?? '')));
}

/** Forgot Password — Step 1: check phone is registered, send reset OTP. */
export async function requestResetOtpAction(form: FormData): Promise<OtpRequestResult> {
  return runAction('auth.request_reset_otp', async () => {
    const r = await authService.requestPasswordResetOtp(String(form.get('phone') ?? ''), await requestMeta());
    return { phone: r.phone, masked: r.masked, resendAfterSeconds: r.resendAfterSeconds };
  });
}

/** Forgot Password — Step 2: verify reset OTP, return proof token for setting new password. */
export async function verifyResetOtpAction(form: FormData): Promise<OtpVerifyProofResult> {
  return runAction('auth.verify_reset_otp', async () => {
    return authService.verifyPasswordResetOtp(
      String(form.get('phone') ?? ''),
      String(form.get('code') ?? ''),
      await requestMeta(),
    );
  });
}

/** Forgot Password — Step 3: save new password (confirmed twice) in DB. */
export async function completeResetPasswordAction(form: FormData): Promise<ResetCompleteResult> {
  return runAction('auth.complete_reset_password', async () => {
    return authService.completePasswordReset(
      String(form.get('proofToken') ?? ''),
      String(form.get('password') ?? ''),
      String(form.get('confirmPassword') ?? ''),
      await requestMeta(),
    );
  });
}
