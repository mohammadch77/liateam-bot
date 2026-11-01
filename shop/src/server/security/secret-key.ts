import 'server-only';
import { getConfig } from '@/lib/config';
import { buildKeyRing, type KeyRing } from '@/lib/crypto/secret-box';

let ring: KeyRing | null | undefined;

/**
 * The key ring for the admin's secrets, from SETTINGS_ENCRYPTION_KEY (+ _VERSION, _OLD_KEYS). Null = secrets are off:
 * the panel then says so and nothing is stored. The key never leaves this process (no log, no response).
 */
export function secretKeyRing(): KeyRing | null {
  if (ring === undefined) {
    const c = getConfig();
    ring = buildKeyRing(
      c.SETTINGS_ENCRYPTION_KEY,
      c.SETTINGS_ENCRYPTION_KEY_VERSION,
      c.SETTINGS_ENCRYPTION_OLD_KEYS,
    );
  }
  return ring;
}
