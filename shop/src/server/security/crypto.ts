import 'server-only';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { getConfig } from '@/lib/config';

/** Uniform random numeric code, e.g. '048213' (randomInt is CSPRNG-backed and unbiased). */
export function generateOtp(length: number): string {
  return Array.from({ length }, () => randomInt(0, 10)).join('');
}

/**
 * HMAC of a short secret bound to its context (phone). A 6-digit code has ~20 bits of entropy, so a plain hash
 * would be reversible from a leaked table in milliseconds; the server-side key prevents that.
 */
export function hmacOtp(phone: string, code: string): string {
  return createHmac('sha256', getConfig().AUTH_SECRET).update(`otp:${phone}:${code}`).digest('hex');
}

/** Session token: 256 random bits for the cookie; only its SHA-256 is stored. */
export function generateSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * An opaque address token for one person in an affiliate's network: the person's id and a keyed MAC of the pair (affiliate, person).
 * It is not a secret and not an authorization: the page still asks the database whether THIS affiliate referred that person (any
 * other pair finds nothing → 404). The MAC only keeps addresses from being guessed or counted up.
 */
export function personToken(affiliateId: string, buyerId: string): string {
  const mac = createHmac('sha256', getConfig().AUTH_SECRET).update(`person:${affiliateId}:${buyerId}`).digest('hex').slice(0, 12);
  return `${Number(buyerId).toString(36)}-${mac}`;
}

/** The person id inside a token, or null when the token is not one this affiliate was given. */
export function readPersonToken(affiliateId: string, token: string): string | null {
  const m = /^([0-9a-z]{1,12})-([0-9a-f]{12})$/.exec(token);
  if (!m) return null;
  const id = String(parseInt(m[1]!, 36));
  if (!/^\d{1,15}$/.test(id)) return null;
  const want = personToken(affiliateId, id).slice(-12);
  const a = Buffer.from(want);
  const b = Buffer.from(m[2]!);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
