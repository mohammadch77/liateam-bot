import { toLatinDigits } from '../phone.mjs';

/**
 * Who may refer whom, pure (no database). One level only: the person who refers must be an active sales affiliate who was not
 * referred themselves, the person referred must be a plain customer (not an affiliate) with no referrer yet, and nobody refers
 * themselves. The referrer is fixed once, at the first sign-up (or, for an older account, before its first paid order) and is
 * never changed after that.
 */
export type ReferralReason =
  | 'bad_format'
  | 'unknown_code'
  | 'referrer_not_affiliate'
  | 'referrer_is_referred'
  | 'self'
  | 'user_is_affiliate'
  | 'already_referred'
  | 'has_paid_order';

export const REFERRAL_MESSAGE: Record<ReferralReason, string> = {
  bad_format: 'کد معرف باید ۴ تا ۲۰ حرف انگلیسی یا عدد باشد.',
  unknown_code: 'این کد معرف معتبر نیست.',
  referrer_not_affiliate: 'این کد معرف معتبر نیست.',
  referrer_is_referred: 'این کد معرف معتبر نیست.',
  self: 'نمی‌توانید خودتان را معرفی کنید.',
  user_is_affiliate: 'همکاران فروش نمی‌توانند با کد معرف ثبت شوند.',
  already_referred: 'برای حساب شما قبلاً معرف ثبت شده و قابل تغییر نیست.',
  has_paid_order: 'کد معرف فقط تا قبل از اولین خرید پرداخت‌شده قابل ثبت است.',
};

export type ReferralCheck = { ok: true } | { ok: false; reason: ReferralReason; message: string };
const no = (reason: ReferralReason): ReferralCheck => ({ ok: false, reason, message: REFERRAL_MESSAGE[reason] });

/** What the customer typed → the code (Persian digits read, lower case, trimmed), or null when it cannot be a code. */
export function parseReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = toLatinDigits(raw).trim().toLowerCase();
  return /^[a-z0-9]{4,20}$/.test(v) ? v : null;
}

export type ReferralFacts = {
  /** the code exists */
  found: boolean;
  referrerId: string | null;
  referrerIsAffiliate: boolean;
  referrerHasReferrer: boolean;
};

/** Only the referrer's side: is this code usable at all (the sign-in form checks it before there is an account). */
export function checkReferrer(f: ReferralFacts): ReferralCheck {
  if (!f.found || !f.referrerId) return no('unknown_code');
  if (!f.referrerIsAffiliate) return no('referrer_not_affiliate');
  if (f.referrerHasReferrer) return no('referrer_is_referred');
  return { ok: true };
}

export type UserFacts = { id: string; hasReferrer: boolean; isAffiliate: boolean; hasPaidOrder: boolean };

/** Both sides: may this user be attached to this code now. */
export function checkReferral(f: ReferralFacts, u: UserFacts): ReferralCheck {
  const r = checkReferrer(f);
  if (!r.ok) return r;
  if (f.referrerId === u.id) return no('self');
  if (u.hasReferrer) return no('already_referred');
  if (u.isAffiliate) return no('user_is_affiliate');
  if (u.hasPaidOrder) return no('has_paid_order');
  return { ok: true };
}

/** Can this user still type a code (checkout / profile): no referrer, not an affiliate, no paid order yet. */
export const canEnterReferral = (u: Omit<UserFacts, 'id'>): boolean => !u.hasReferrer && !u.isAffiliate && !u.hasPaidOrder;

/** An affiliate application is refused for a user who has a referrer (a referred person never becomes an affiliate). */
export const APPLICATION_REFUSED_REFERRED =
  'حساب شما با کد یا لینک معرف ثبت شده است و امکان همکاری در فروش برای آن فعال نیست.';
