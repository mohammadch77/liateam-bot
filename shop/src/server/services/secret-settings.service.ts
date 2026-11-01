import 'server-only';
import { open, seal } from '@/lib/crypto/secret-box';
import { AppError } from '@/lib/errors';
import { secretHint, SETTINGS, isSecretKey, type SettingKey } from '@/lib/settings/registry';
import { secretSettingsRepository } from '@/server/repositories/secret-settings.repository';
import type { Queryable } from '@/server/repositories/transaction';
import { secretKeyRing } from '@/server/security/secret-key';

/**
 * The only door to the plaintext of a secret. `read` is for server code that needs the value (the SMS and payment
 * clients of S2): no page, action or API route returns what it gives. `store` seals a value for the admin service.
 * Nothing here logs a value, a hint or an error that carries one.
 */
export const secretStorageEnabled = (): boolean => secretKeyRing() !== null;

const need = (key: string): SettingKey => {
  if (!isSecretKey(key)) throw new Error(`${key} is not a secret setting`);
  return key as SettingKey;
};

export const secretSettingsService = {
  /** the secret's value, or null when it was never set; throws when the key is off or the row cannot be opened */
  async read(key: string): Promise<string | null> {
    need(key);
    const ring = secretKeyRing();
    if (!ring)
      throw new AppError('CONFIG_INVALID', {
        message: 'کلید رمزنگاری تنظیمات (SETTINGS_ENCRYPTION_KEY) تنظیم نشده است.',
      });
    const sealed = await secretSettingsRepository.sealed(key);
    return sealed ? open(ring, key, sealed) : null;
  },

  /** seals and saves (replacing any earlier value); the caller has already checked the admin and validated the value */
  async store(db: Queryable, key: string, value: string, by: string): Promise<void> {
    need(key);
    const ring = secretKeyRing();
    if (!ring)
      throw new AppError('CONFIG_INVALID', {
        message: 'ذخیره‌ی راز غیرفعال است: SETTINGS_ENCRYPTION_KEY در .env تنظیم نشده است.',
      });
    await secretSettingsRepository.upsert(db, key, seal(ring, key, value), secretHint(value), by);
  },

  label: (key: SettingKey) => SETTINGS[key].label,
};
