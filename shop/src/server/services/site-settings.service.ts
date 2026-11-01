import 'server-only';
import { getConfig } from '@/lib/config';
import type { DiscountMode } from '@/server/repositories/discount.repository';
import { indexingBlocked } from '@/server/seo-policy';
import { settingsRead } from './settings-read.service';

export type SiteSettings = {
  /** how the customer's base discount is made; default: the partner discount */
  discountMode: DiscountMode;
  /** the admin's switch «جلوگیری از ایندکس شدن»; default on (blocked) */
  blockIndexing: boolean;
};

/**
 * The site-wide switches the storefront reads (discount mode, indexing), through the settings registry. Reading never
 * fails a page: on a database error the safe defaults apply (indexing blocked). Changing them is the admin settings
 * service's job (src/server/services/settings.service.ts).
 */
export const siteSettingsService = {
  async get(): Promise<SiteSettings> {
    const v = await settingsRead.all();
    return {
      discountMode: v.get('pricing.discount_mode') as DiscountMode,
      blockIndexing: v.get('seo.block_indexing') as boolean,
    };
  },

  async discountMode(): Promise<DiscountMode> {
    return (await this.get()).discountMode;
  },

  /** Search engines kept out: the admin's switch, and always outside production (staging, development). */
  indexingBlocked,

  /** The switch cannot open the site outside production (shown on the settings page). */
  indexingForcedByEnvironment(): boolean {
    return getConfig().APP_ENV !== 'production';
  },
};
