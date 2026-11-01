import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for the secrets of the admin panel. Pure functions: the key ring is passed in (the server wrapper reads it
 * from SETTINGS_ENCRYPTION_KEY), so the unit tests need no environment.
 *
 *  - a fresh random 96-bit nonce for every encryption (the table also has a UNIQUE constraint on it)
 *  - the setting's key is the additional authenticated data: a ciphertext copied onto another key's row fails to open
 *  - every row records the key VERSION it was sealed with; the ring may hold older versions, so a key can be rotated
 *    without losing what is stored (new writes always use the current version)
 *  - errors never carry the plaintext, the key or the ciphertext
 */
export type KeyRing = { current: number; keys: ReadonlyMap<number, Buffer> };
export type Sealed = { ciphertext: Buffer; nonce: Buffer; keyVersion: number };

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** 64 hex characters (32 bytes), e.g. `openssl rand -hex 32` */
export function parseKeyHex(hex: string): Buffer | null {
  return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

/**
 * Builds the ring from the environment's values: `current` hex (version `version`), and optional `old` = "1:hex,2:hex" for
 * versions that still open existing rows. Returns null when the current key is missing or malformed (secrets stay off).
 */
export function buildKeyRing(current: string | undefined, version = 1, old?: string): KeyRing | null {
  const key = current ? parseKeyHex(current.trim()) : null;
  if (!key || !Number.isInteger(version) || version < 1 || version > 32_000) return null;
  const keys = new Map<number, Buffer>();
  for (const part of (old ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [v, hex] = part.split(':');
    const parsed = hex ? parseKeyHex(hex) : null;
    if (!parsed || !/^\d+$/.test(v ?? '')) return null;
    keys.set(Number(v), parsed);
  }
  keys.set(version, key);
  return { current: version, keys };
}

export function seal(ring: KeyRing, aad: string, plaintext: string): Sealed {
  const key = ring.keys.get(ring.current);
  if (!key || key.length !== KEY_BYTES) throw new Error('secret key is not available');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce, keyVersion: ring.current };
}

export function open(ring: KeyRing, aad: string, sealed: Sealed): string {
  const key = ring.keys.get(sealed.keyVersion);
  if (!key) throw new Error(`no key for version ${sealed.keyVersion}`);
  if (sealed.nonce.length !== NONCE_BYTES || sealed.ciphertext.length < TAG_BYTES)
    throw new Error('stored secret is malformed');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('stored secret cannot be opened (wrong key or altered data)');
  }
}
