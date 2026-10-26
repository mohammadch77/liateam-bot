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
  /** how the customer's base discount is made; default: the partner discount */
  discountMode: DiscountMode;
  /** the admin's switch «جلوگیری از ایندکس شدن»; default on (blocked) */
  blockIndexing: boolean;
};

const defaults = (): SiteSettings => ({
  discountMode: getConfig().DEFAULT_DISCOUNT_MODE,
  blockIndexing: true,
});
const MAX_AGE_MS = 60_000;
let cached: { value: SiteSettings; at: number } | null = null;
onDataChange(() => (cached = null));

/** the stored mode; the names of the first version ('liateam', 'excess') read as 'consumer' and 'beyond_base' */
function parseMode(v: unknown): DiscountMode {
  if (v === undefined || v === null) return getConfig().DEFAULT_DISCOUNT_MODE;
  if (v === 'consumer' || v === 'liateam') return 'consumer';
  if (v === 'beyond_base' || v === 'excess') return 'beyond_base';
  return 'partner';
}

const parse = (rows: Map<string, unknown>): SiteSettings => ({
  discountMode: parseMode(rows.get(KEYS.discountMode)),
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
      return defaults();
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
    if (!['partner', 'consumer', 'beyond_base'].includes(next.discountMode))
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
