import 'server-only';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  PLAIN_KEYS,
  SETTINGS,
  isSecretKey,
  parseStored,
  type SettingKey,
  type SettingValue,
} from '@/lib/settings/registry';
import { onDataChange } from '@/server/cache-events';
import { siteSettingsRepository } from '@/server/repositories/site-settings.repository';

/**
 * Reading the registry's plain settings (never secrets): one query for all of them, cached a minute and dropped at once
 * by dataChanged() (an admin save, the bot's revalidate). A missing, malformed or unreadable value is the default, and a
 * failed read is not cached. Kept apart from the admin service so the access guards can read the session length without
 * a circular import.
 */
const MAX_AGE_MS = 60_000;
type Values = ReadonlyMap<SettingKey, unknown>;
let cached: { value: Values; at: number } | null = null;
onDataChange(() => (cached = null));

/** the default of a setting; the discount mode starts from the environment until an admin saves one */
function defaultOf(key: SettingKey): unknown {
  return key === 'pricing.discount_mode' ? getConfig().DEFAULT_DISCOUNT_MODE : SETTINGS[key].default;
}

function parseAll(rows: ReadonlyMap<string, unknown>): Values {
  return new Map(
    PLAIN_KEYS.map((k) => [k, rows.has(k) ? parseStored(k, rows.get(k)) : defaultOf(k)] as const),
  );
}

export const settingsRead = {
  /** straight from the database (the admin form's "before"); throws on a database error */
  async fresh(): Promise<Values> {
    return parseAll(await siteSettingsRepository.get(PLAIN_KEYS));
  },

  async all(): Promise<Values> {
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.value;
    try {
      const value = await this.fresh();
      cached = { value, at: Date.now() };
      return value;
    } catch (e) {
      logger.warn('settings.unavailable', { err: e });
      return new Map(PLAIN_KEYS.map((k) => [k, defaultOf(k)] as const));
    }
  },

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    if (isSecretKey(key)) throw new Error('secrets are read only through secretSettingsService');
    return (await this.all()).get(key) as SettingValue<K>;
  },

  forget(): void {
    cached = null;
  },
};
