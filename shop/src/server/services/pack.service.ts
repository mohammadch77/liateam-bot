import 'server-only';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import { packLive, packState, savingPercent, type PackStepState } from '@/lib/pricing/packs';
import { auditRepository } from '@/server/repositories/audit.repository';
import {
  packRepository,
  type CollectionInput,
  type CollectionRow,
  type PackInput,
  type PackItemRow,
  type PackRow,
} from '@/server/repositories/pack.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { authorize } from '@/server/auth/guards';
import { onDataChange } from '@/server/cache-events';
import type { RequestMeta } from '@/server/http/request';
import { packPath } from '@/lib/urls';
import { catalogService, type ProductView } from './catalog.service';
import { pricingRules } from './pricing.service';
import { siteSettingsService } from './site-settings.service';

/**
 * Packs («روتین پوستی»): the storefront view (each step's product at its current shop price, the items' total, the
 * pack price from the database and the saving; unavailable when a product is out of stock or gone) and the admin
 * side (validation in Persian, the floor check — «تخفیف بیش از حد مجاز است», never a number — preview, audit).
 */

export const PACK_POLICY = { maxSteps: 8, cacheMs: 30_000 } as const;

export type PackStepView = PackStepState & { product: ProductView | null };

export type PackView = {
  id: number;
  key: string;
  variantTitle: string;
  title: string;
  description: string;
  href: string;
  steps: PackStepView[];
  /** the items' total at their current shop prices (struck through) */
  total: number;
  /** the pack price; null = not available now (a product out of stock / gone, or cannot be priced) */
  final: number | null;
  saving: number;
  available: boolean;
};

export type CollectionView = {
  slug: string;
  title: string;
  subtitle: string;
  variantLabel: string;
  packs: PackView[];
};

export { packPath };

async function view(collection: CollectionRow, packs: PackRow[], items: PackItemRow[]): Promise<PackView[]> {
  const products = await catalogService.productViews(
    items.flatMap((i) => (i.product_id ? [i.product_id] : [])),
  );
  const minMargin = (await siteSettingsService.discountMode()) === 'partner' ? 0 : pricingRules().minMargin;
  return Promise.all(
    packs.map(async (p) => {
      const state = packState(
        items
          .filter((i) => i.pack_id === p.id)
          .map((i) => ({ label: i.step_label, productId: i.product_id })),
        (id) => {
          const v = products.get(id);
          return v ? { price: v.priceToman, inStock: v.stock !== 'out' } : null;
        },
      );
      const listTotal = state.steps.reduce((n, st) => {
        const v = st.status === 'ok' && st.productId ? products.get(st.productId) : undefined;
        return n + (v ? (v.oldPriceToman ?? v.priceToman) : 0);
      }, 0);
      let priced = state.available
        ? await packRepository.price(
            state.productIds,
            state.total,
            p.discount_kind,
            p.discount_value,
            minMargin,
            p.allow_loss,
          )
        : null;
      // no pack discount: the pack is the sum of its items' prices — no purchase price is needed, so an item the
      // database cannot price (or an older function) never hides a pack that has nothing to protect
      if (!priced && state.available && p.discount_kind === 'percent' && p.discount_value === 0)
        priced = { final: state.total, clamped: false };
      if (!priced)
        logger.warn('pack.unavailable', {
          pack: p.variant_key,
          reason: !state.available
            ? state.steps.some((st) => st.status === 'out')
              ? 'an item is out of stock or not sold'
              : 'no products'
            : 'the price function returned no row (an item without a purchase price, or the function is missing)',
        });
      const final = priced?.final ?? null;
      return {
        id: p.id,
        key: p.variant_key,
        variantTitle: p.variant_title,
        title: p.title,
        description: p.description,
        href: packPath(collection.slug, p.variant_key),
        steps: state.steps.map((s) => ({
          ...s,
          product: s.productId ? (products.get(s.productId) ?? null) : null,
        })),
        // struck through: the items' list prices; the pack discount (default none) applies to their final prices
        total: listTotal,
        final,
        saving: final !== null ? savingPercent(listTotal, final) : 0,
        available: final !== null,
      };
    }),
  );
}

const cache = new Map<string, { at: number; value: CollectionView | null }>();
onDataChange(() => cache.clear());

/** A collection's running packs (null when the collection is off or has none). Cached for 30 s. */
async function liveCollection(slug: string): Promise<CollectionView | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < PACK_POLICY.cacheMs) return hit.value;
  const collection = await packRepository.collectionBySlug(slug);
  let value: CollectionView | null = null;
  if (collection?.active) {
    const now = new Date();
    const packs = (await packRepository.packs(collection.id)).filter((p) =>
      packLive({ active: p.active, startsAt: p.starts_at, endsAt: p.ends_at }, now),
    );
    if (packs.length) {
      const items = await packRepository.items(packs.map((p) => p.id));
      value = {
        slug: collection.slug,
        title: collection.title,
        subtitle: collection.subtitle,
        variantLabel: collection.variant_label,
        packs: await view(collection, packs, items),
      };
    }
  }
  cache.set(slug, { at: Date.now(), value });
  return value;
}

// ── admin input ──
const faDigits = (v: unknown) =>
  typeof v === 'string'
    ? v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[,٬\s]/g, '')
    : v;
const flag = z
  .string()
  .optional()
  .transform((v) => v === 'on' || v === '1');
const TEHRAN = '+03:30';
const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00${TEHRAN}`) : new Date(NaN);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: 'custom', message: `${label} معتبر نیست` });
        return z.NEVER;
      }
      return d;
    });
const slug = (label: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, `${label} فقط حروف کوچک انگلیسی، عدد و خط تیره (مثل skin-routine)`)
    .max(60, `${label} حداکثر ۶۰ نویسه است`);

const collectionSchema = z.object({
  slug: slug('نشانی مجموعه'),
  title: z.string().trim().min(2, 'عنوان مجموعه را بنویسید').max(80, 'عنوان مجموعه حداکثر ۸۰ نویسه است'),
  subtitle: z.string().trim().max(200, 'زیرعنوان حداکثر ۲۰۰ نویسه است').default(''),
  variantLabel: z.string().trim().min(2, 'نام گونه‌ها را بنویسید (مثلاً نوع پوست)').max(40),
  active: flag,
  sortOrder: z.preprocess(faDigits, z.coerce.number().int().min(0).max(1000).catch(0)),
});

const packSchema = z
  .object({
    collectionId: z.preprocess(
      faDigits,
      z.coerce.number({ message: 'مجموعه را انتخاب کنید' }).int().positive('مجموعه را انتخاب کنید'),
    ),
    variantKey: slug('نشانی گونه').pipe(z.string().max(40, 'نشانی گونه حداکثر ۴۰ نویسه است')),
    variantTitle: z.string().trim().min(2, 'نام گونه را بنویسید (مثلاً پوست چرب)').max(40),
    title: z.string().trim().min(3, 'عنوان پک حداقل ۳ نویسه است').max(100, 'عنوان پک حداکثر ۱۰۰ نویسه است'),
    description: z.string().trim().max(600, 'توضیح حداکثر ۶۰۰ نویسه است'),
    discountKind: z.enum(['percent', 'fixed_price'], { message: 'نوع تخفیف پک را انتخاب کنید' }),
    discountValue: z.preprocess(
      faDigits,
      z.coerce.number({ message: 'مقدار تخفیف عدد نیست' }).int('مقدار تخفیف باید عدد صحیح باشد'),
    ),
    active: flag,
    allowLoss: flag,
    startsAt: optionalDate('شروع'),
    endsAt: optionalDate('پایان'),
    sortOrder: z.preprocess(faDigits, z.coerce.number().int().min(0).max(1000).catch(0)),
    steps: z
      .array(z.object({ label: z.string().trim(), product: z.preprocess(faDigits, z.string()) }))
      .max(PACK_POLICY.maxSteps),
  })
  .superRefine((p, ctx) => {
    if (p.discountKind === 'percent' && (p.discountValue < 0 || p.discountValue > 90))
      ctx.addIssue({ code: 'custom', message: 'درصد تخفیف پک باید بین ۰ (بدون تخفیف) تا ۹۰ باشد' });
    if (p.discountKind === 'fixed_price' && p.discountValue < 1000)
      ctx.addIssue({ code: 'custom', message: 'قیمت ثابت پک باید از ۱٬۰۰۰ تومان بیشتر باشد' });
    if (p.endsAt && p.startsAt && p.endsAt <= p.startsAt)
      ctx.addIssue({ code: 'custom', message: 'پایان باید بعد از شروع باشد' });
    const filled = p.steps.filter((s) => s.label || s.product);
    if (!filled.length) ctx.addIssue({ code: 'custom', message: 'دست‌کم یک مرحله با محصول لازم است' });
    for (const [i, s] of filled.entries()) {
      if (s.label.length < 2) ctx.addIssue({ code: 'custom', message: `نام مرحله‌ی ${i + 1} را بنویسید` });
      if (s.product && !/^\d+/.test(s.product))
        ctx.addIssue({ code: 'custom', message: `محصول مرحله‌ی «${s.label}» را از فهرست انتخاب کنید` });
    }
  });

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new AppError('INVALID_DATA', { message: r.error.issues[0]?.message ?? 'اطلاعات معتبر نیست' });
  return r.data;
}

function toPackInput(raw: unknown): PackInput {
  const v = parse(packSchema, raw);
  return {
    collectionId: v.collectionId,
    variantKey: v.variantKey,
    variantTitle: v.variantTitle,
    title: v.title,
    description: v.description,
    discountKind: v.discountKind,
    discountValue: v.discountValue,
    active: v.active,
    allowLoss: v.allowLoss,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    sortOrder: v.sortOrder,
    steps: v.steps
      .filter((s) => s.label || s.product)
      .map((s) => ({ label: s.label, productId: s.product ? Number(s.product.match(/^\d+/)![0]) : null })),
  };
}

export type PackPreview = {
  steps: Array<{ label: string; name: string | null; price: number | null }>;
  total: number;
  final: number | null;
  saving: number;
  /** some product is out of stock right now: the pack shows «فعلاً در دسترس نیست» */
  unavailableNow: boolean;
  /** the pack price is under the items' purchase prices (+ margin): a yes/no, never a number */
  atLoss: boolean;
};

/** The pack priced as if every product were in stock (the floor check), plus the preview. */
async function check(p: PackInput): Promise<PackPreview & { unsafe: boolean }> {
  const ids = p.steps.flatMap((s) => (s.productId ? [s.productId] : []));
  const products = await catalogService.productViews(ids);
  const missing = p.steps.find((s) => s.productId && !products.has(s.productId));
  if (missing)
    throw new AppError('INVALID_DATA', {
      message: `محصول مرحله‌ی «${missing.label}» پیدا نشد یا فروخته نمی‌شود`,
    });
  const total = ids.reduce((n, id) => n + products.get(id)!.priceToman, 0);
  const listTotal = ids.reduce(
    (n, id) => n + (products.get(id)!.oldPriceToman ?? products.get(id)!.priceToman),
    0,
  );
  let priced = await packRepository.price(
    ids,
    total,
    p.discountKind,
    p.discountValue,
    (await siteSettingsService.discountMode()) === 'partner' ? 0 : pricingRules().minMargin,
    p.allowLoss,
  );
  if (!priced && ids.length && p.discountKind === 'percent' && p.discountValue === 0)
    priced = { final: total, clamped: false }; // no pack discount: the sum of the items, no purchase price needed
  if (ids.length && !priced)
    throw new AppError('INTERNAL', { message: 'محاسبه‌ی قیمت پک هنوز روی سرور نصب نشده است.' });
  return {
    steps: p.steps.map((s) => {
      const v = s.productId ? products.get(s.productId) : undefined;
      return { label: s.label, name: v?.name ?? null, price: v?.priceToman ?? null };
    }),
    total: listTotal,
    final: priced?.final ?? null,
    saving: priced ? savingPercent(listTotal, priced.final) : 0,
    unavailableNow: ids.some((id) => products.get(id)!.stock === 'out'),
    atLoss: !!priced?.clamped,
    unsafe: !priced || priced.clamped,
  };
}

export const packService = {
  /** Storefront: the running packs of a collection, or null. */
  collection: liveCollection,

  /** Every running collection in the panel's order: each one is a section of the home page. Never fails the page. */
  async homeCollections(): Promise<CollectionView[]> {
    const all = (await packRepository.collections()).filter((c) => c.active);
    const views = await Promise.all(all.map((c) => liveCollection(c.slug).catch(() => null)));
    return views.filter((v): v is CollectionView => v !== null);
  },

  /** Move a collection one place up or down in the panel's order (admins only; audited; nothing is deleted). */
  async moveCollection(id: number, dir: -1 | 1, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    await withTransaction(async (db) => {
      const ids = (await packRepository.collections()).map((c) => c.id);
      const from = ids.indexOf(id);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      await packRepository.reorderCollections(ids, db);
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'pack_collection.move',
          entityType: 'pack_collection',
          entityId: String(id),
          meta: { dir },
          ip: meta.ip,
        },
        db,
      );
    });
    cache.clear();
  },

  /** Move a pack (a tab of its collection) one place up or down. */
  async movePack(id: number, dir: -1 | 1, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    await withTransaction(async (db) => {
      const pack = await packRepository.pack(id);
      if (!pack) throw new AppError('NOT_FOUND');
      const ids = (await packRepository.packs(pack.collection_id)).map((p) => p.id);
      const from = ids.indexOf(id);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      await packRepository.reorderPacks(pack.collection_id, ids, db);
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'pack.move',
          entityType: 'pack',
          entityId: String(id),
          meta: { dir },
          ip: meta.ip,
        },
        db,
      );
    });
    cache.clear();
  },

  async pack(
    collectionSlug: string,
    key: string,
  ): Promise<{ collection: CollectionView; pack: PackView } | null> {
    const c = await liveCollection(collectionSlug);
    const pack = c?.packs.find((p) => p.key === key);
    return c && pack ? { collection: c, pack } : null;
  },

  // ── admin ──
  async adminData() {
    await authorize('admin');
    const [collections, packs] = await Promise.all([packRepository.collections(), packRepository.packs()]);
    const items = await packRepository.items(packs.map((p) => p.id));
    return { collections, packs, items };
  },

  async previewPack(raw: unknown): Promise<PackPreview> {
    await authorize('admin');
    const { unsafe: _unsafe, ...preview } = await check(toPackInput(raw));
    void _unsafe;
    return preview;
  },

  async savePack(id: number | null, raw: unknown, meta: RequestMeta): Promise<number> {
    const admin = await authorize('admin');
    const input = toPackInput(raw);
    const r = await check(input);
    // under the floor only with the admin's «اجازه‌ی فروش با زیان» (a pack that cannot be priced never)
    if (r.unsafe && !(input.allowLoss && r.final !== null)) throw new AppError('DISCOUNT_UNSAFE');
    const saved = await withTransaction(async (db) => {
      const packId = await packRepository.savePack(id, input, admin.id, db);
      if (!packId) throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: id === null ? 'pack.create' : 'pack.update',
          entityType: 'pack',
          entityId: String(packId),
          meta: {
            kind: input.discountKind,
            value: input.discountValue,
            steps: input.steps.length,
            allowLoss: input.allowLoss,
            atLoss: r.atLoss,
          },
          ip: meta.ip,
        },
        db,
      );
      return packId;
    }).catch((e) => {
      if (e instanceof AppError && e.code === 'CONFLICT')
        throw new AppError('CONFLICT', { message: 'این مجموعه گونه‌ای با همین نشانی دارد' });
      throw e;
    });
    cache.clear();
    return saved;
  },

  async setPackActive(id: number, active: boolean, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    await withTransaction(async (db) => {
      if (!(await packRepository.setPackActive(id, active, db))) throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: active ? 'pack.enable' : 'pack.disable',
          entityType: 'pack',
          entityId: String(id),
          ip: meta.ip,
        },
        db,
      );
    });
    cache.clear();
  },

  async saveCollection(id: number | null, raw: unknown, meta: RequestMeta): Promise<number> {
    const admin = await authorize('admin');
    const v = parse(collectionSchema, raw);
    const input: CollectionInput = {
      slug: v.slug,
      title: v.title,
      subtitle: v.subtitle,
      variantLabel: v.variantLabel,
      active: v.active,
      sortOrder: v.sortOrder,
    };
    const saved = await withTransaction(async (db) => {
      const cid = id === null ? await packRepository.insertCollection(input, db) : id;
      if (id !== null && !(await packRepository.updateCollection(id, input, db)))
        throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: id === null ? 'pack_collection.create' : 'pack_collection.update',
          entityType: 'pack_collection',
          entityId: String(cid),
          meta: { slug: input.slug, active: input.active },
          ip: meta.ip,
        },
        db,
      );
      return cid;
    }).catch((e) => {
      if (e instanceof AppError && e.code === 'CONFLICT')
        throw new AppError('CONFLICT', { message: 'مجموعه‌ای با همین نشانی وجود دارد' });
      throw e;
    });
    cache.clear();
    return saved;
  },
};
