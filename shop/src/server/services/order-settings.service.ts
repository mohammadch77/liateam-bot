import 'server-only';
import { logger } from '@/lib/logger';
import {
  DEFAULT_ORDER_SETTINGS,
  ORDER_SETTING_KEYS,
  parseOrderSettings,
  type OrderSettings,
} from '@/lib/orders/settings';
import { siteSettingsRepository } from '@/server/repositories/site-settings.repository';
import { onDataChange } from '@/server/cache-events';

const MAX_AGE_MS = 60_000;
let cached: { value: OrderSettings; at: number } | null = null;
onDataChange(() => (cached = null));

/** The order flow's settings (price tolerance, automatic placing, free shipping), cached a minute; the defaults when the database cannot be read. */
export const orderSettingsService = {
  async get(): Promise<OrderSettings> {
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.value;
    let value = DEFAULT_ORDER_SETTINGS;
    try {
      value = parseOrderSettings(await siteSettingsRepository.get(Object.values(ORDER_SETTING_KEYS)));
    } catch (e) {
      logger.warn('order_settings.unavailable', { err: e });
    }
    cached = { value, at: Date.now() };
    return value;
  },
};
