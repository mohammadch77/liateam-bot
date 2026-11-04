import 'server-only';
import { AppError } from '@/lib/errors';
import {
  canEnterReferral,
  checkReferral,
  checkReferrer,
  parseReferralCode,
  REFERRAL_MESSAGE,
  type ReferralCheck,
  type ReferralFacts,
} from '@/lib/affiliate/referral';
import { logger } from '@/lib/logger';
import { authorize } from '@/server/auth/guards';
import { setReferralCode } from '@/server/auth/referral-cookie';
import { rateLimit } from '@/server/http/rate-limit';
import { auditRepository } from '@/server/repositories/audit.repository';
import { commissionRepository } from '@/server/repositories/commission.repository';
import { withTransaction, type Queryable } from '@/server/repositories/transaction';
import type { RequestMeta } from '@/server/http/request';

/**
 * The referral code, one level: who may use whose code is decided by the pure rules in src/lib/affiliate/referral.ts; this service
 * only reads the facts. A referrer is fixed once and never changed (the table's primary key refuses a second one).
 */
async function factsOf(code: string, db?: Queryable): Promise<ReferralFacts> {
  const r = await commissionRepository.referrerFacts(code, db);
  return {
    found: !!r,
    referrerId: r?.referrer_id ?? null,
    referrerIsAffiliate: r?.is_affiliate ?? false,
    referrerHasReferrer: r?.has_referrer ?? false,
  };
}

export const referralService = {
  /**
   * Inside the sign-up's transaction: a new account is attached to the code it came with (the link's cookie or the typed code).
   * Anything wrong is a silent no-op (the account is made regardless). Returns whether a referrer was recorded.
   */
  async attachAtSignup(userId: string, code: string, db: Queryable): Promise<boolean> {
    try {
      const facts = await factsOf(code, db);
      const user = await commissionRepository.userFacts(userId, db);
      const ok = checkReferral(facts, {
        id: userId,
        hasReferrer: user.has_referrer,
        isAffiliate: user.is_affiliate,
        hasPaidOrder: user.has_paid_order,
      });
      if (!ok.ok || !facts.referrerId) return false;
      return await commissionRepository.refer(userId, facts.referrerId, code, db);
    } catch (e) {
      logger.warn('referral.attach_failed', { err: e instanceof Error ? e.message : 'unknown' });
      return false;
    }
  },

  /**
   * The sign-in form's «کد معرف (اختیاری)»: a typed code is checked now (it must belong to an active affiliate who was not referred)
   * and kept in the referral cookie, which the first sign-up then reads exactly like the link's. Returns the message when it is refused.
   */
  async rememberTyped(raw: string, ip: string | null): Promise<string | null> {
    if (!raw.trim()) return null;
    rateLimit(`referral-typed:${ip ?? 'unknown'}`, 20, 10 * 60_000);
    const code = parseReferralCode(raw);
    if (!code) return REFERRAL_MESSAGE.bad_format;
    const r = checkReferrer(await factsOf(code));
    if (!r.ok) return r.message;
    await setReferralCode(code);
    return null;
  },

  /** What the checkout and the profile need: may a code still be typed, and the code the account was referred with. */
  async stateFor(userId: string): Promise<{ canEnter: boolean; code: string | null }> {
    const [facts, code] = await Promise.all([
      commissionRepository.userFacts(userId),
      commissionRepository.referredByCode(userId),
    ]);
    return {
      canEnter: canEnterReferral({
        hasReferrer: facts.has_referrer,
        isAffiliate: facts.is_affiliate,
        hasPaidOrder: facts.has_paid_order,
      }),
      code,
    };
  },

  /** A signed-in customer types a code before their first paid order. Locked once recorded. */
  async enter(raw: string, meta: RequestMeta): Promise<{ code: string }> {
    const user = await authorize();
    rateLimit(`referral-enter:${user.id}`, 10, 10 * 60_000);
    const code = parseReferralCode(raw);
    if (!code) throw new AppError('INVALID_DATA', { message: REFERRAL_MESSAGE.bad_format });
    return withTransaction(async (db) => {
      const facts = await factsOf(code, db);
      const u = await commissionRepository.userFacts(user.id, db);
      const ok: ReferralCheck = checkReferral(facts, {
        id: user.id,
        hasReferrer: u.has_referrer,
        isAffiliate: u.is_affiliate,
        hasPaidOrder: u.has_paid_order,
      });
      if (!ok.ok) throw new AppError('INVALID_DATA', { message: ok.message });
      const done = await commissionRepository.refer(user.id, facts.referrerId!, code, db);
      if (!done) throw new AppError('CONFLICT', { message: 'برای حساب شما قبلاً معرف ثبت شده و قابل تغییر نیست.' });
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'referral.enter',
          entityType: 'user',
          entityId: user.id,
          meta: { code },
          ip: meta.ip,
        },
        db,
      );
      return { code };
    });
  },
};
