import 'server-only';
import { getConfig } from '@/lib/config';
import { withTransaction } from '@/server/repositories/transaction';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { digitsOnly, maskMobile, normalizeMobile } from '@/lib/phone';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import { otpRepository } from '@/server/repositories/otp.repository';
import { sessionRepository } from '@/server/repositories/session.repository';
import { userRepository } from '@/server/repositories/user.repository';
import {
  generateOtp,
  generateSessionToken,
  hashSessionToken,
  hmacOtp,
  safeEqualHex,
} from '@/server/security/crypto';
import { getSmsProvider } from '@/server/sms';

/** Security policy for sign-in. All limits in one place. */
export const OTP_POLICY = {
  length: 6,
  ttlSeconds: 120, // a code is valid for 2 minutes
  resendSeconds: 60, // at most one code per phone per minute
  perPhonePerHour: 5,
  perIpPerHour: 20,
  attemptsPerCode: 5, // then the code is dead; a new one must be requested
  lockAfterFailures: 10, // wrong codes for one phone within the window → locked
  lockWindowSeconds: 30 * 60,
} as const;

const HOUR = 3600;

export type OtpRequested = {
  phone: string;
  masked: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
};
export type SignedIn = { userId: string; token: string; expiresAt: Date; isNewUser: boolean };

function parsePhone(input: string): string {
  const phone = normalizeMobile(input);
  if (!phone) throw new AppError('INVALID_DATA', { message: 'شماره موبایل معتبر نیست. مثال: ۰۹۱۲۱۲۳۴۵۶۷' });
  return phone;
}

export const authService = {
  /**
   * Sends a login code. The answer is identical whether or not the number is registered, so the form cannot be
   * used to discover customers. Limits are checked under a per-phone lock, so parallel requests cannot race past.
   */
  async requestOtp(phoneInput: string, meta: RequestMeta): Promise<OtpRequested> {
    const phone = parsePhone(phoneInput);
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
        throw new AppError('RATE_LIMITED');
      }
      if (meta.ip && (await otpRepository.countForIp(db, meta.ip, HOUR)) >= OTP_POLICY.perIpPerHour) {
        throw new AppError('RATE_LIMITED');
      }

      const existing = await userRepository.findLiveByPhone(phone, db);
      await otpRepository.insert(db, {
        phone,
        codeHash: hmacOtp(phone, code),
        purpose: existing ? 'login' : 'register',
        ttlSeconds: OTP_POLICY.ttlSeconds,
        ip: meta.ip,
      });
    });

    // Sent after COMMIT: a stored code always counts toward the limits, even if the gateway fails.
    await getSmsProvider().sendOtp(phone, code);
    logger.info('auth.otp_sent', { to: maskMobile(phone), provider: getSmsProvider().name });
    return {
      phone,
      masked: maskMobile(phone),
      resendAfterSeconds: OTP_POLICY.resendSeconds,
      expiresInSeconds: OTP_POLICY.ttlSeconds,
    };
  },

  /** Checks the code; on success signs the user in (creating the account with role customer on first login). */
  async verifyOtp(phoneInput: string, codeInput: string, meta: RequestMeta): Promise<SignedIn> {
    const phone = parsePhone(phoneInput);
    const code = digitsOnly(codeInput);
    if (code.length !== OTP_POLICY.length) throw new AppError('INVALID_CODE');

    if (
      (await otpRepository.failedAttempts(phone, OTP_POLICY.lockWindowSeconds)) >=
      OTP_POLICY.lockAfterFailures
    ) {
      throw new AppError('LOCKED');
    }

    // One attempt is spent before comparing, atomically, so guesses cannot outrun the counter.
    const otp = await otpRepository.spendAttempt(phone, OTP_POLICY.attemptsPerCode);
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

    const { token, hash } = generateSessionToken();
    const signedIn = await withTransaction(async (db) => {
      if (!(await otpRepository.consume(db, otp.id))) throw new AppError('INVALID_CODE'); // replayed

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
      return { userId: user.id, expiresAt: session.expires_at, isNewUser: created };
    });

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
