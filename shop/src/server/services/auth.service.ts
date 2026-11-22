import 'server-only';
import { getConfig } from '@/lib/config';
import { withTransaction } from '@/server/repositories/transaction';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { digitsOnly, maskMobile, normalizeMobile, toLatinDigits } from '@/lib/phone';
import type { RequestMeta } from '@/server/http/request';
import { rateLimit } from '@/server/http/rate-limit';
import { auditRepository } from '@/server/repositories/audit.repository';
import { otpRepository, type OtpPurpose } from '@/server/repositories/otp.repository';
import { sessionRepository } from '@/server/repositories/session.repository';
import { userRepository } from '@/server/repositories/user.repository';
import {
  generateOtp,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  hmacOtp,
  safeEqualHex,
  signAuthProof,
  verifyAuthProof,
  verifyPassword,
} from '@/server/security/crypto';
import { clearReferralCode, readReferralCode } from '@/server/auth/referral-cookie';
import { referralService } from './referral.service';
import { smsService } from './sms.service';

/** Security policy for sign-in, registration & password reset. All limits in one place. */
export const OTP_POLICY = {
  length: 6,
  ttlSeconds: 120, // a code is valid for 2 minutes
  resendSeconds: 60, // at most one code per phone per minute
  perPhonePerHour: 5,
  perIpPerHour: 20,
  attemptsPerCode: 5, // then the code is dead; a new one must be requested
  lockAfterFailures: 10, // wrong codes for one phone within the window → locked
  lockWindowSeconds: 30 * 60,
  proofTtlSeconds: 10 * 60, // 10 minutes to finish setting a password after OTP verification
} as const;

export const PASSWORD_POLICY = {
  minLength: 4,
  maxLength: 128,
} as const;

const HOUR = 3600;

export type OtpRequested = {
  phone: string;
  masked: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
};
export type OtpVerifiedProof = {
  phone: string;
  masked: string;
  proofToken: string;
};
export type SignedIn = { userId: string; token: string; expiresAt: Date; isNewUser: boolean };

function parsePhone(input: string): string {
  const phone = normalizeMobile(input);
  if (!phone) throw new AppError('INVALID_DATA', { message: 'شماره موبایل معتبر نیست. مثال: ۰۹۱۲۱۲۳۴۵۶۷' });
  return phone;
}

/**
 * Simple password policy: any 4–128 characters (no uppercase, symbol or digit-mix requirement).
 * Persian/Arabic numerals are normalized to ASCII digits so mobile keyboard switches never break login.
 */
function parsePassword(input: string, label = 'رمز عبور'): string {
  const normalized = toLatinDigits(input);
  if (!normalized || normalized.length < PASSWORD_POLICY.minLength) {
    throw new AppError('INVALID_DATA', {
      message: `${label} باید حداقل ۴ کاراکتر باشد.`,
    });
  }
  if (normalized.length > PASSWORD_POLICY.maxLength) {
    throw new AppError('INVALID_DATA', {
      message: `${label} بیش از حد طولانی است.`,
    });
  }
  return normalized;
}

async function issueOtpForPurpose(
  phone: string,
  purpose: OtpPurpose,
  meta: RequestMeta,
): Promise<OtpRequested> {
  const code = generateOtp(OTP_POLICY.length);

  await withTransaction(async (db) => {
    await otpRepository.lockPhone(db, phone);

    if (
      (await otpRepository.failedAttempts(phone, OTP_POLICY.lockWindowSeconds, db)) >=
      OTP_POLICY.lockAfterFailures
    ) {
      throw new AppError('LOCKED');
    }
    const recent = await otpRepository.recentForPhone(db, phone, HOUR);
    const sinceLast = recent.lastAt ? (Date.now() - recent.lastAt.getTime()) / 1000 : Infinity;
    if (sinceLast < OTP_POLICY.resendSeconds || recent.count >= OTP_POLICY.perPhonePerHour) {
      throw new AppError('RATE_LIMITED', {
        message:
          sinceLast < OTP_POLICY.resendSeconds
            ? `لطفاً ${Math.ceil(OTP_POLICY.resendSeconds - sinceLast)} ثانیه صبر کنید و دوباره تلاش کنید.`
            : 'درخواست‌ها بیش از حد مجاز است. چند دقیقه بعد دوباره تلاش کنید.',
      });
    }
    if (meta.ip && (await otpRepository.countForIp(db, meta.ip, HOUR)) >= OTP_POLICY.perIpPerHour) {
      throw new AppError('RATE_LIMITED');
    }

    await otpRepository.insert(db, {
      phone,
      codeHash: hmacOtp(phone, code),
      purpose,
      ttlSeconds: OTP_POLICY.ttlSeconds,
      ip: meta.ip,
    });
  });

  // Sent after COMMIT: a stored code always counts toward the limits, even if the gateway fails.
  const provider = await smsService.sendOtp(phone, code);
  logger.info('auth.otp_sent', { to: maskMobile(phone), purpose, provider });
  return {
    phone,
    masked: maskMobile(phone),
    resendAfterSeconds: OTP_POLICY.resendSeconds,
    expiresInSeconds: OTP_POLICY.ttlSeconds,
  };
}

async function verifyOtpCode(
  phone: string,
  codeInput: string,
  purpose: OtpPurpose | undefined,
  meta: RequestMeta,
): Promise<{ id: string; purpose: OtpPurpose }> {
  const code = digitsOnly(codeInput);
  if (code.length !== OTP_POLICY.length) throw new AppError('INVALID_CODE');

  if (
    (await otpRepository.failedAttempts(phone, OTP_POLICY.lockWindowSeconds)) >=
    OTP_POLICY.lockAfterFailures
  ) {
    throw new AppError('LOCKED');
  }

  // One attempt is spent before comparing, atomically, so guesses cannot outrun the counter.
  const otp = await otpRepository.spendAttempt(phone, OTP_POLICY.attemptsPerCode, purpose);
  if (!otp || !safeEqualHex(hmacOtp(phone, code), otp.code_hash)) {
    const failed = await otpRepository.failedAttempts(phone, OTP_POLICY.lockWindowSeconds);
    if (failed >= OTP_POLICY.lockAfterFailures) {
      if (failed === OTP_POLICY.lockAfterFailures) {
        await auditRepository.record({
          actorUserId: null,
          action: 'auth.locked',
          entityType: 'phone',
          entityId: maskMobile(phone),
          meta: { failures: failed },
          ip: meta.ip,
        });
      }
      throw new AppError('LOCKED');
    }
    throw new AppError('INVALID_CODE');
  }

  return { id: otp.id, purpose: otp.purpose };
}

export const authService = {
  /** Login with phone number (username) + password. */
  async loginWithPassword(
    phoneInput: string,
    passwordInput: string,
    meta: RequestMeta,
  ): Promise<SignedIn> {
    if (meta.ip) rateLimit(`auth-pw-ip:${meta.ip}`, 40, 15 * 60_000);
    const phone = parsePhone(phoneInput);
    rateLimit(`auth-pw-phone:${phone}`, 10, 15 * 60_000);

    const password = toLatinDigits(passwordInput);
    if (!password) {
      throw new AppError('INVALID_DATA', { message: 'لطفاً رمز عبور را وارد کنید.' });
    }

    const user = await userRepository.findLiveByPhoneWithAuth(phone);
    if (!user) {
      throw new AppError('UNAUTHORIZED', { message: 'شماره موبایل یا رمز عبور اشتباه است.' });
    }
    if (user.status === 'suspended') throw new AppError('ACCOUNT_DISABLED');
    if (!user.password_hash) {
      throw new AppError('INVALID_DATA', {
        message:
          'برای این حساب هنوز رمز عبور ثبت نشده است. می‌توانید با «کد پیامکی» وارد شوید یا از «فراموشی رمز عبور» رمز تعیین کنید.',
      });
    }

    const matched = await verifyPassword(password, user.password_hash);
    if (!matched) {
      await auditRepository.record({
        actorUserId: user.id,
        action: 'auth.password_failed',
        entityType: 'user',
        entityId: user.id,
        ip: meta.ip,
      });
      throw new AppError('UNAUTHORIZED', { message: 'شماره موبایل یا رمز عبور اشتباه است.' });
    }

    const { token, hash } = generateSessionToken();
    const session = await withTransaction(async (db) => {
      await userRepository.touchLogin(db, user.id);
      const s = await sessionRepository.create(db, {
        userId: user.id,
        tokenHash: hash,
        ttlDays: getConfig().SESSION_TTL_DAYS,
        userAgent: meta.userAgent,
        ip: meta.ip,
      });
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          meta: { method: 'password', sessionId: s.id },
          ip: meta.ip,
        },
        db,
      );
      return s;
    });

    logger.info('auth.login', { userId: user.id, method: 'password' });
    return { userId: user.id, token, expiresAt: session.expires_at, isNewUser: false };
  },

  /** Login via SMS OTP — Step 1: ensure phone belongs to an existing account, then send code. */
  async requestLoginOtp(phoneInput: string, meta: RequestMeta): Promise<OtpRequested> {
    if (meta.ip) rateLimit(`auth-otp-check:${meta.ip}`, 30, 15 * 60_000);
    const phone = parsePhone(phoneInput);
    const existing = await userRepository.findLiveByPhone(phone);
    if (!existing) {
      throw new AppError('NOT_FOUND', {
        message: 'حسابی با این شماره موبایل ثبت نشده است. لطفاً ابتدا ثبت‌نام کنید.',
      });
    }
    if (existing.status === 'suspended') throw new AppError('ACCOUNT_DISABLED');
    return issueOtpForPurpose(phone, 'login', meta);
  },

  /** Login via SMS OTP — Step 2: verify code and sign the existing user in. */
  async verifyLoginOtp(phoneInput: string, codeInput: string, meta: RequestMeta): Promise<SignedIn> {
    const phone = parsePhone(phoneInput);
    const otp = await verifyOtpCode(phone, codeInput, 'login', meta);

    const { token, hash } = generateSessionToken();
    const signedIn = await withTransaction(async (db) => {
      if (!(await otpRepository.consume(db, otp.id))) throw new AppError('INVALID_CODE');
      const user = await userRepository.findLiveByPhone(phone, db);
      if (!user) {
        throw new AppError('NOT_FOUND', {
          message: 'حسابی با این شماره موبایل ثبت نشده است. لطفاً ابتدا ثبت‌نام کنید.',
        });
      }
      if (user.status === 'suspended') throw new AppError('ACCOUNT_DISABLED');

      await userRepository.touchLogin(db, user.id);
      const session = await sessionRepository.create(db, {
        userId: user.id,
        tokenHash: hash,
        ttlDays: getConfig().SESSION_TTL_DAYS,
        userAgent: meta.userAgent,
        ip: meta.ip,
      });
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          meta: { method: 'otp', newUser: false, sessionId: session.id },
          ip: meta.ip,
        },
        db,
      );
      return { userId: user.id, expiresAt: session.expires_at, isNewUser: false };
    });

    logger.info('auth.login', { userId: signedIn.userId, method: 'otp' });
    return { ...signedIn, token };
  },

  /** Registration — Step 1: verify phone is not registered yet, then send SMS code. */
  async requestRegisterOtp(phoneInput: string, meta: RequestMeta): Promise<OtpRequested> {
    if (meta.ip) rateLimit(`auth-otp-check:${meta.ip}`, 30, 15 * 60_000);
    const phone = parsePhone(phoneInput);
    const existing = await userRepository.findLiveByPhone(phone);
    if (existing) {
      throw new AppError('CONFLICT', {
        message: 'این شماره موبایل قبلاً ثبت‌نام شده است. لطفاً از بخش ورود اقدام کنید.',
      });
    }
    return issueOtpForPurpose(phone, 'register', meta);
  },

  /** Registration — Step 2: verify SMS code and issue short-lived proof for password step. */
  async verifyRegisterOtp(
    phoneInput: string,
    codeInput: string,
    meta: RequestMeta,
  ): Promise<OtpVerifiedProof> {
    const phone = parsePhone(phoneInput);
    const otp = await verifyOtpCode(phone, codeInput, 'register', meta);

    const consumedAt = await withTransaction(async (db) => {
      const existing = await userRepository.findLiveByPhone(phone, db);
      if (existing) {
        throw new AppError('CONFLICT', {
          message: 'این شماره موبایل قبلاً ثبت‌نام شده است. لطفاً از بخش ورود اقدام کنید.',
        });
      }
      const at = await otpRepository.consume(db, otp.id);
      if (!at) throw new AppError('INVALID_CODE');
      return at;
    });

    const proofToken = signAuthProof({
      phone,
      purpose: 'register',
      otpId: otp.id,
      consumedAt: consumedAt.getTime(),
      exp: Date.now() + OTP_POLICY.proofTtlSeconds * 1000,
    });
    return { phone, masked: maskMobile(phone), proofToken };
  },

  /** Registration — Step 3: set mandatory simple password, create account, attach referral, sign in. */
  async completeRegister(
    proofToken: string,
    passwordInput: string,
    confirmPasswordInput: string,
    meta: RequestMeta,
  ): Promise<SignedIn> {
    const proof = verifyAuthProof(proofToken, 'register');
    if (!proof) {
      throw new AppError('INVALID_CODE', {
        message: 'مهلت تکمیل ثبت‌نام به پایان رسید. لطفاً دوباره کد تأیید دریافت کنید.',
      });
    }

    const password = parsePassword(passwordInput, 'رمز عبور');
    const confirm = toLatinDigits(confirmPasswordInput);
    if (password !== confirm) {
      throw new AppError('INVALID_DATA', { message: 'رمز عبور و تکرار آن یکسان نیستند.' });
    }

    const passwordHash = await hashPassword(password);
    const refCode = await readReferralCode().catch(() => null);
    const { token, hash } = generateSessionToken();

    const signedIn = await withTransaction(async (db) => {
      const consumed = await otpRepository.findConsumed(
        db,
        proof.otpId,
        proof.phone,
        'register',
        OTP_POLICY.proofTtlSeconds + 60,
      );
      if (!consumed) {
        throw new AppError('INVALID_CODE', {
          message: 'مهلت تکمیل ثبت‌نام به پایان رسید. لطفاً دوباره تلاش کنید.',
        });
      }

      const user = await userRepository.createWithPassword(db, proof.phone, passwordHash);
      if (!user) {
        throw new AppError('CONFLICT', {
          message: 'این شماره موبایل قبلاً ثبت‌نام شده است. لطفاً از بخش ورود اقدام کنید.',
        });
      }

      if (await userRepository.grantRole(db, user.id, 'customer', null)) {
        await auditRepository.record(
          {
            actorUserId: null,
            action: 'role.grant',
            entityType: 'user',
            entityId: user.id,
            meta: { role: 'customer', via: 'signup' },
            ip: meta.ip,
          },
          db,
        );
      }

      await userRepository.touchLogin(db, user.id);
      const session = await sessionRepository.create(db, {
        userId: user.id,
        tokenHash: hash,
        ttlDays: getConfig().SESSION_TTL_DAYS,
        userAgent: meta.userAgent,
        ip: meta.ip,
      });
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          meta: { method: 'register_password', newUser: true, sessionId: session.id },
          ip: meta.ip,
        },
        db,
      );
      if (refCode) await referralService.attachAtSignup(user.id, refCode, db);
      return { userId: user.id, expiresAt: session.expires_at, isNewUser: true };
    });

    if (refCode) await clearReferralCode().catch(() => {});
    logger.info('auth.register', { userId: signedIn.userId });
    return { ...signedIn, token };
  },

  /** Forgot Password — Step 1: check phone is registered, then send SMS reset code. */
  async requestPasswordResetOtp(phoneInput: string, meta: RequestMeta): Promise<OtpRequested> {
    if (meta.ip) rateLimit(`auth-otp-check:${meta.ip}`, 30, 15 * 60_000);
    const phone = parsePhone(phoneInput);
    const existing = await userRepository.findLiveByPhone(phone);
    if (!existing) {
      throw new AppError('NOT_FOUND', {
        message: 'حسابی با این شماره موبایل ثبت نشده است.',
      });
    }
    if (existing.status === 'suspended') throw new AppError('ACCOUNT_DISABLED');
    return issueOtpForPurpose(phone, 'reset_password', meta);
  },

  /** Forgot Password — Step 2: verify reset SMS code and issue short-lived reset proof. */
  async verifyPasswordResetOtp(
    phoneInput: string,
    codeInput: string,
    meta: RequestMeta,
  ): Promise<OtpVerifiedProof> {
    const phone = parsePhone(phoneInput);
    const otp = await verifyOtpCode(phone, codeInput, 'reset_password', meta);

    const consumedAt = await withTransaction(async (db) => {
      const existing = await userRepository.findLiveByPhone(phone, db);
      if (!existing) {
        throw new AppError('NOT_FOUND', { message: 'حسابی با این شماره موبایل ثبت نشده است.' });
      }
      if (existing.status === 'suspended') throw new AppError('ACCOUNT_DISABLED');
      const at = await otpRepository.consume(db, otp.id);
      if (!at) throw new AppError('INVALID_CODE');
      return at;
    });

    const proofToken = signAuthProof({
      phone,
      purpose: 'reset_password',
      otpId: otp.id,
      consumedAt: consumedAt.getTime(),
      exp: Date.now() + OTP_POLICY.proofTtlSeconds * 1000,
    });
    return { phone, masked: maskMobile(phone), proofToken };
  },

  /** Forgot Password — Step 3: verify proof, confirm new password twice, save in DB, revoke old sessions. */
  async completePasswordReset(
    proofToken: string,
    passwordInput: string,
    confirmPasswordInput: string,
    meta: RequestMeta,
  ): Promise<{ phone: string }> {
    const proof = verifyAuthProof(proofToken, 'reset_password');
    if (!proof) {
      throw new AppError('INVALID_CODE', {
        message: 'مهلت تغییر رمز عبور به پایان رسید. لطفاً دوباره کد بازیابی دریافت کنید.',
      });
    }

    const password = parsePassword(passwordInput, 'رمز عبور جدید');
    const confirm = toLatinDigits(confirmPasswordInput);
    if (password !== confirm) {
      throw new AppError('INVALID_DATA', { message: 'رمز عبور جدید و تکرار آن یکسان نیستند.' });
    }

    const passwordHash = await hashPassword(password);

    await withTransaction(async (db) => {
      const consumed = await otpRepository.findConsumed(
        db,
        proof.otpId,
        proof.phone,
        'reset_password',
        OTP_POLICY.proofTtlSeconds + 60,
      );
      if (!consumed) {
        throw new AppError('INVALID_CODE', {
          message: 'مهلت تغییر رمز عبور به پایان رسید. لطفاً دوباره تلاش کنید.',
        });
      }

      const user = await userRepository.findLiveByPhoneWithAuth(proof.phone, db);
      if (!user) throw new AppError('NOT_FOUND', { message: 'حسابی با این شماره موبایل ثبت نشده است.' });
      if (user.status === 'suspended') throw new AppError('ACCOUNT_DISABLED');
      if (user.password_updated_at && user.password_updated_at.getTime() >= proof.consumedAt) {
        throw new AppError('INVALID_CODE', {
          message: 'این کد قبلاً برای تغییر رمز استفاده شده است.',
        });
      }

      await userRepository.updatePassword(db, user.id, passwordHash);
      await sessionRepository.revokeAllForUser(db, user.id);
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'auth.password_reset',
          entityType: 'user',
          entityId: user.id,
          ip: meta.ip,
        },
        db,
      );
    });

    logger.info('auth.password_reset', { to: maskMobile(proof.phone) });
    return { phone: proof.phone };
  },

  /** Backwards-compatible generic OTP request (used by legacy helpers if any). */
  async requestOtp(phoneInput: string, meta: RequestMeta): Promise<OtpRequested> {
    const phone = parsePhone(phoneInput);
    const existing = await userRepository.findLiveByPhone(phone);
    return issueOtpForPurpose(phone, existing ? 'login' : 'register', meta);
  },

  /** Backwards-compatible generic OTP verify. */
  async verifyOtp(phoneInput: string, codeInput: string, meta: RequestMeta): Promise<SignedIn> {
    const phone = parsePhone(phoneInput);
    const otp = await verifyOtpCode(phone, codeInput, undefined, meta);

    const refCode = await readReferralCode().catch(() => null);
    const { token, hash } = generateSessionToken();
    const signedIn = await withTransaction(async (db) => {
      if (!(await otpRepository.consume(db, otp.id))) throw new AppError('INVALID_CODE');

      const { user, created } = await userRepository.findOrCreate(db, phone);
      if (user.status === 'suspended') throw new AppError('ACCOUNT_DISABLED');
      if (created && (await userRepository.grantRole(db, user.id, 'customer', null))) {
        await auditRepository.record(
          {
            actorUserId: null,
            action: 'role.grant',
            entityType: 'user',
            entityId: user.id,
            meta: { role: 'customer', via: 'signup' },
            ip: meta.ip,
          },
          db,
        );
      }
      await userRepository.touchLogin(db, user.id);
      const session = await sessionRepository.create(db, {
        userId: user.id,
        tokenHash: hash,
        ttlDays: getConfig().SESSION_TTL_DAYS,
        userAgent: meta.userAgent,
        ip: meta.ip,
      });
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          meta: { method: 'otp', newUser: created, sessionId: session.id },
          ip: meta.ip,
        },
        db,
      );
      if (created && refCode) await referralService.attachAtSignup(user.id, refCode, db);
      return { userId: user.id, expiresAt: session.expires_at, isNewUser: created };
    });
    if (refCode) await clearReferralCode().catch(() => {});

    logger.info('auth.login', { userId: signedIn.userId, newUser: signedIn.isNewUser });
    return { ...signedIn, token };
  },

  /** Revokes the session behind this cookie token (no-op if it is already gone). */
  async logout(token: string, meta: RequestMeta): Promise<void> {
    const revoked = await sessionRepository.revoke(hashSessionToken(token));
    if (revoked) {
      await auditRepository.record({
        actorUserId: revoked.user_id,
        action: 'auth.logout',
        entityType: 'user',
        entityId: revoked.user_id,
        ip: meta.ip,
      });
    }
  },
};
