import 'server-only';
import type { OrderSettings } from '@/lib/orders/settings';
import { settingsRead } from './settings-read.service';

/**
 * The order flow's settings (price tolerance, automatic placing, free shipping, extra delivery days), read through the
 * settings registry (cached a minute, dropped at once when an admin saves or the bot revalidates); the defaults when the
 * database cannot be read.
 */
export const orderSettingsService = {
  async get(): Promise<OrderSettings> {
    const v = await settingsRead.all();
    return {
      priceToleranceToman: v.get('orders.price_tolerance_toman') as number,
      autoPlaceEnabled: v.get('orders.auto_place_enabled') as boolean,
      autoPlaceHours: v.get('orders.auto_place_hours') as OrderSettings['autoPlaceHours'],
      freeShipping: {
        enabled: v.get('shipping.free_enabled') as boolean,
        fromToman: v.get('shipping.free_from_toman') as number,
      },
      deliveryExtraDays: v.get('shipping.extra_days') as number,
    };
  },
};
