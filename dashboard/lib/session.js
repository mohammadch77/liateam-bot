// Signed session cookie (HS256 JWT). Shared by proxy.js (edge-safe: jose only) and server code.
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE = 'lia_dash';
export const MAX_AGE = 12 * 3600; // seconds

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET missing or shorter than 32 characters');
  return new TextEncoder().encode(s);
}

export async function signSession(user) {
  return new SignJWT({ sub: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
}

/** @returns username or null */
export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE !== '0', // HTTPS behind the reverse proxy; 0 only for plain-http local testing
  path: '/',
  maxAge: MAX_AGE,
});
