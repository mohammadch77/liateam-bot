import 'server-only';
import { getConfig } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { authorize } from '@/server/auth/guards';
import { dataChanged, onDataChange } from '@/server/cache-events';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import type { DiscountMode } from '@/server/repositories/discount.repository';
import { siteSettingsRepository } from '@/server/repositories/site-settings.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { BLOCK_INDEXING_KEY, forgetIndexingPolicy, indexingBlocked } from '@/server/seo-policy';

const KEYS = { discountMode: 'pricing.discount_mode', blockIndexing: BLOCK_INDEXING_KEY } as const;

export type SiteSettings = {
  /** how Liateam's discount reaches the customer; default: the discount liateam.ir shows */
  discountMode: DiscountMode;
  /** the admin's switch «جلوگیری از ایندکس شدن»; default on (blocked) */
  blockIndexing: boolean;
};

const DEFAULTS: SiteSettings = { discountMode: 'liateam', blockIndexing: true };
const MAX_AGE_MS = 60_000;
let cached: { value: SiteSettings; at: number } | null = null;
onDataChange(() => (cached = null));

const parse = (rows: Map<string, unknown>): SiteSettings => ({
  discountMode: rows.get(KEYS.discountMode) === 'excess' ? 'excess' : 'liateam',
  blockIndexing: rows.get(KEYS.blockIndexing) !== false,
});

/**
 * The settings page of the panel (/admin/settings): a few site-wide switches, cached a minute. Reading never fails a
 * page: on a database error the safe defaults are used (Liateam's own discount, indexing blocked).
 */
export const siteSettingsService = {
  async get(): Promise<SiteSettings> {
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.value;
    try {
      const value = parse(await siteSettingsRepository.get(Object.values(KEYS)));
      cached = { value, at: Date.now() };
      return value;
    } catch (e) {
      logger.warn('site_settings.unavailable', { code: e instanceof AppError ? e.code : 'INTERNAL' });
      return DEFAULTS;
    }
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

  /** Admins only; audited; prices and pages pick the change up at once. */
  async update(next: SiteSettings, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    if (next.discountMode !== 'liateam' && next.discountMode !== 'excess')
      throw new AppError('INVALID_DATA', { message: 'روش اعمال تخفیف نامعتبر است.' });
    const before = await this.get();
    await withTransaction(async (db) => {
      for (const [field, key] of Object.entries(KEYS) as [keyof SiteSettings, string][]) {
        if (before[field] === next[field]) continue;
        await siteSettingsRepository.set(key, next[field], admin.id, db);
        await auditRepository.record(
          {
            actorUserId: admin.id,
            action: 'setting.update',
            entityType: 'setting',
            entityId: key,
            meta: { before: before[field], after: next[field] },
            ip: meta.ip,
          },
          db,
        );
      }
    });
    cached = null;
    forgetIndexingPolicy();
    dataChanged(); // prices are computed again with the new mode
  },
};
