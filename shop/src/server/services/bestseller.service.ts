import 'server-only';
import { AppError } from '@/lib/errors';
import {
  BESTSELLER_TABS,
  composeBestsellers,
  isTabKey,
  type BestsellerSource,
  type BestsellerTabKey,
} from '@/lib/bestsellers';
import { auditRepository } from '@/server/repositories/audit.repository';
import { bestsellerRepository } from '@/server/repositories/bestseller.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { authorize } from '@/server/auth/guards';
import { onDataChange } from '@/server/cache-events';
import type { RequestMeta } from '@/server/http/request';
import { catalogService, type ProductView } from './catalog.service';

/**
 * «پرفروش‌ترین‌ها»: each home tab's list (the admin's picks → Liateam's best-selling tag → fill-up, only sellable
 * products in stock; src/lib/bestsellers.ts), cached per tab for a minute and dropped on a panel change or the bot's
 * revalidate call; and the panel (/admin/bestsellers): add / reorder / switch off picks, the Liateam-tag switch, the
 * preview. Admin changes are audited.
 */

const CACHE_MS = 60_000;
const tagSettingKey = (tab: BestsellerTabKey) => `bestsellers.use_tag.${tab}`;

export type BestsellerItem = ProductView & { source: BestsellerSource };

const cache = new Map<BestsellerTabKey, { at: number; items: BestsellerItem[] }>();
onDataChange(() => cache.clear());

async function compute(tab: BestsellerTabKey): Promise<BestsellerItem[]> {
  const def = BESTSELLER_TABS.find((t) => t.key === tab)!;
  const [picks, settings] = await Promise.all([
    bestsellerRepository.picks(tab),
    bestsellerRepository.settings('bestsellers.'),
  ]);
  const pickIds = picks.filter((p) => p.enabled).map((p) => p.product_id);
  const candidates = await bestsellerRepository.candidates(def.categories, pickIds);
  const list = composeBestsellers(pickIds, candidates, {
    useLiateamTag: settings.get(tagSettingKey(tab)) !== false,
  });
  const views = await catalogService.productViews(list.map((x) => x.id));
  return list.flatMap((x) => {
    const v = views.get(x.id);
    return v && v.stock !== 'out' ? [{ ...v, source: x.source }] : [];
  });
}

async function tab(key: BestsellerTabKey): Promise<BestsellerItem[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const items = await compute(key);
  cache.set(key, { at: Date.now(), items });
  return items;
}

export const bestsellerService = {
  tabs: BESTSELLER_TABS,
  tab,

  /** Every tab at once (the home section switches tabs without a request). */
  async all(): Promise<Array<{ key: BestsellerTabKey; label: string; items: BestsellerItem[] }>> {
    return Promise.all(
      BESTSELLER_TABS.map(async (t) => ({ key: t.key, label: t.label, items: await tab(t.key) })),
    );
  },

  // ── admin ──
  async adminTab(key: BestsellerTabKey) {
    await authorize('admin');
    const [picks, settings, preview, names] = await Promise.all([
      bestsellerRepository.picks(key),
      bestsellerRepository.settings('bestsellers.'),
      compute(key),
      catalogService.productNames(),
    ]);
    const name = new Map(names.map((n) => [n.id, n.name]));
    return {
      picks: picks.map((p) => ({ ...p, name: name.get(p.product_id) ?? 'دیگر فروخته نمی‌شود' })),
      useLiateamTag: settings.get(tagSettingKey(key)) !== false,
      preview,
      products: names,
    };
  },

  async addPick(key: string, product: string, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    if (!isTabKey(key)) throw new AppError('INVALID_DATA', { message: 'تب نامعتبر است' });
    const id = Number(
      String(product)
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .match(/^\s*(\d+)/)?.[1],
    );
    if (!Number.isInteger(id) || !(await catalogService.productViews([id])).has(id))
      throw new AppError('INVALID_DATA', {
        message: 'محصول را از فهرست انتخاب کنید (محصولی که فروخته می‌شود)',
      });
    await withTransaction(async (db) => {
      await bestsellerRepository.addPick(key, id, admin.id, db);
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'bestseller.add',
          entityType: 'bestseller',
          entityId: `${key}:${id}`,
          ip: meta.ip,
        },
        db,
      );
    });
    cache.clear();
  },

  async setPickEnabled(id: number, enabled: boolean, meta: RequestMeta): Promise<BestsellerTabKey> {
    const admin = await authorize('admin');
    const row = await withTransaction(async (db) => {
      const r = await bestsellerRepository.setPickEnabled(id, enabled, db);
      if (!r) throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: enabled ? 'bestseller.enable' : 'bestseller.disable',
          entityType: 'bestseller',
          entityId: `${r.tab_key}:${r.product_id}`,
          ip: meta.ip,
        },
        db,
      );
      return r;
    });
    cache.clear();
    return row.tab_key;
  },

  async movePick(id: number, dir: -1 | 1, meta: RequestMeta): Promise<BestsellerTabKey> {
    const admin = await authorize('admin');
    const row = await withTransaction(async (db) => {
      const r = await bestsellerRepository.movePick(id, dir, db);
      if (!r) throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'bestseller.move',
          entityType: 'bestseller',
          entityId: `${r.tab_key}:${r.product_id}`,
          meta: { dir },
          ip: meta.ip,
        },
        db,
      );
      return r;
    });
    cache.clear();
    return row.tab_key;
  },

  async setUseLiateamTag(key: string, on: boolean, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    if (!isTabKey(key)) throw new AppError('INVALID_DATA', { message: 'تب نامعتبر است' });
    await withTransaction(async (db) => {
      await bestsellerRepository.setSetting(tagSettingKey(key), on, admin.id, db);
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'setting.update',
          entityType: 'setting',
          entityId: tagSettingKey(key),
          meta: { value: on },
          ip: meta.ip,
        },
        db,
      );
    });
    cache.clear();
  },
};
