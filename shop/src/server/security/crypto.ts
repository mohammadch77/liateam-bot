import 'server-only';
import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { getConfig } from '@/lib/config';

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const;

function deriveScrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

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

/** Hashes a user password with scrypt + 16-byte random salt. Format: `scrypt$<saltHex>$<keyHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveScrypt(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Constant-time password verification against a stored `scrypt$salt$key` hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, keyHex] = parts;
  if (!saltHex || !keyHex || saltHex.length !== 32 || keyHex.length !== SCRYPT_KEYLEN * 2) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await deriveScrypt(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type AuthProofPurpose = 'register' | 'reset_password';
export type AuthProofPayload = {
  phone: string;
  purpose: AuthProofPurpose;
  otpId: string;
  consumedAt: number;
  exp: number;
};

/** Short-lived HMAC-signed proof that an OTP was verified for a phone + purpose, before setting a password. */
export function signAuthProof(payload: AuthProofPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', getConfig().AUTH_SECRET)
    .update(`auth-proof:${body}`)
    .digest('base64url');
  return `${body}.${mac}`;
}

export function verifyAuthProof(token: string, expectedPurpose: AuthProofPurpose): AuthProofPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!body || !mac) return null;
  const want = createHmac('sha256', getConfig().AUTH_SECRET)
    .update(`auth-proof:${body}`)
    .digest('base64url');
  const a = Buffer.from(want);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<AuthProofPayload>;
    if (
      typeof parsed.phone !== 'string' ||
      parsed.purpose !== expectedPurpose ||
      typeof parsed.otpId !== 'string' ||
      typeof parsed.consumedAt !== 'number' ||
      typeof parsed.exp !== 'number' ||
      Date.now() > parsed.exp
    ) {
      return null;
    }
    return parsed as AuthProofPayload;
  } catch {
    return null;
  }
}
