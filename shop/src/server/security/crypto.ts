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
