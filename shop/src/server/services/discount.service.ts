import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { bestManual, covers, type Discount } from '@/lib/pricing/discounts';
import { auditRepository } from '@/server/repositories/audit.repository';
import { catalogRepository } from '@/server/repositories/catalog.repository';
import {
  discountRepository,
  toDiscount,
  type CampaignInput,
  type DiscountInput,
} from '@/server/repositories/discount.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { authorize } from '@/server/auth/guards';
import type { RequestMeta } from '@/server/http/request';
import { pricingRules, pricingService } from './pricing.service';

/**
 * Admin side of our discounts and campaigns: validation (Persian messages), the safety check before saving (a
 * discount the purchase-price floor would cut is refused with «تخفیف بیش از حد مجاز است», never with a number),
 * the preview (how many products, a few example prices — Liateam's price and ours only) and the audit trail.
 */

export const DISCOUNT_POLICY = { previewSamples: 6, labelMax: 60 } as const;

/** «1405-…» is not accepted: the panel sends the browser's datetime-local value, read as Tehran time. */
const TEHRAN_OFFSET = '+03:30';
const localDate = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `${label} را کامل وارد کنید`)
    .transform((v) => new Date(`${v}:00${TEHRAN_OFFSET}`))
    .refine((d) => !Number.isNaN(d.getTime()), `${label} معتبر نیست`);
const optionalDate = (label: string) => z.union([z.literal('').transform(() => null), localDate(label)]);
const faDigits = (v: unknown) =>
  typeof v === 'string'
    ? v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[,٬\s]/g, '')
    : v;

const discountSchema = z
  .object({
    scope: z.enum(['product', 'category', 'brand', 'all'], { message: 'دامنه‌ی تخفیف را انتخاب کنید' }),
    target: z
      .preprocess(faDigits, z.string())
      .transform((v) => (v ? Number(v.match(/^\d+/)?.[0] ?? NaN) : null)),
    kind: z.enum(['percent', 'amount'], { message: 'نوع تخفیف را انتخاب کنید' }),
    value: z.preprocess(
      faDigits,
      z.coerce.number({ message: 'مقدار تخفیف عدد نیست' }).int('مقدار تخفیف باید عدد صحیح باشد'),
    ),
    startsAt: optionalDate('شروع'),
    endsAt: optionalDate('پایان'),
    label: z.string().trim().max(DISCOUNT_POLICY.labelMax, 'برچسب حداکثر ۶۰ نویسه است'),
    campaign: z.preprocess(faDigits, z.string()).transform((v) => (v ? Number(v) : null)),
    active: z
      .string()
      .optional()
      .transform((v) => v === 'on' || v === '1'),
    allowLoss: z
      .string()
      .optional()
      .transform((v) => v === 'on' || v === '1'),
  })
  .superRefine((d, ctx) => {
    if (d.scope !== 'all' && !(d.target && Number.isInteger(d.target) && d.target > 0))
      ctx.addIssue({ code: 'custom', message: 'محصول، دسته یا برند را از فهرست انتخاب کنید' });
    if (d.kind === 'percent' && (d.value < 1 || d.value > 90))
      ctx.addIssue({ code: 'custom', message: 'درصد تخفیف باید بین ۱ تا ۹۰ باشد' });
    if (d.kind === 'amount' && (d.value < 1000 || d.value > 1_000_000_000))
      ctx.addIssue({ code: 'custom', message: 'مبلغ تخفیف باید از ۱٬۰۰۰ تومان بیشتر باشد' });
    if (d.endsAt && d.endsAt <= (d.startsAt ?? new Date()))
      ctx.addIssue({ code: 'custom', message: 'پایان باید بعد از شروع باشد' });
  });

const campaignSchema = z.object({
  title: z.string().trim().min(3, 'عنوان کمپین حداقل ۳ نویسه است').max(80, 'عنوان کمپین حداکثر ۸۰ نویسه است'),
  bannerText: z
    .string()
    .trim()
    .min(3, 'متن نوار حداقل ۳ نویسه است')
    .max(120, 'متن نوار حداکثر ۱۲۰ نویسه است'),
  endsAt: localDate('پایان کمپین').refine((d) => d > new Date(), 'پایان کمپین باید در آینده باشد'),
  link: z
    .string()
    .trim()
    .transform((v) => v || '/offers')
    .refine(
      (v) => /^\/[A-Za-z0-9/_?=&%.-]*$/.test(v) && v.length <= 200,
      'پیوند باید یک مسیر داخلی مثل /offers باشد',
    ),
  active: z
    .string()
    .optional()
    .transform((v) => v === 'on' || v === '1'),
});

function parse<T>(schema: z.ZodType<T>, raw: Record<string, unknown>): T {
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new AppError('INVALID_DATA', { message: r.error.issues[0]?.message ?? 'اطلاعات معتبر نیست' });
  return r.data;
}

export type DiscountPreview = {
  affected: number;
  /** how many of them this discount would sell under the purchase price (a count, never a price) */
  atLoss: number;
  samples: Array<{ id: number; name: string; price: number; final: number }>;
};

/**
 * Products this discount covers, its preview, and whether it reaches the floor anywhere (`unsafe`). With «loss
 * allowed» the preview prices are the real (unfloored) ones and `atLoss` says on how many products.
 */
async function check(input: DiscountInput): Promise<DiscountPreview & { unsafe: boolean }> {
  const [rows, cats] = await Promise.all([
    discountRepository.pricingRows(),
    catalogRepository.listCategories(),
  ]);
  const parent = new Map(cats.map((c) => [c.code, c.parent_code]));
  const up = (codes: number[]) => {
    const out = new Set<number>();
    for (const code of codes)
      for (let c: number | null | undefined = code, n = 0; c != null && n < 10 && !out.has(c); n++) {
        out.add(c);
        c = parent.get(c);
      }
    return [...out];
  };
  const d: Discount = {
    id: 0,
    scope: input.scope,
    targetCode: input.targetCode,
    kind: input.kind,
    value: input.value,
    startsAt: new Date(0),
    endsAt: null,
    active: true,
    allowLoss: input.allowLoss,
    campaignId: null,
    campaignActive: null,
    campaignEndsAt: null,
  };
  const affected = rows
    .map((r) => ({ r, p: { id: r.id, price: r.price, categories: up(r.category), brandCode: r.brand_code } }))
    .filter(({ p }) => covers(d, p));
  const items = affected.map(({ p }) => ({ id: p.id, ...bestManual(p, [d], new Date(1)) }));
  const prices = await discountRepository.offerPrices(items, pricingRules());
  if (!prices) throw new AppError('INTERNAL', { message: 'محاسبه‌ی قیمت تخفیف هنوز روی سرور نصب نشده است.' });
  const sampleIds = affected.slice(0, DISCOUNT_POLICY.previewSamples).map(({ r }) => r.id);
  const names = new Map((await catalogRepository.productsByIds(sampleIds)).map((r) => [r.id, r.name]));
  return {
    affected: affected.length,
    atLoss: affected.filter(({ r }) => prices.get(r.id)?.clamped).length,
    // a product the database cannot price gets no discount at all: counted as unsafe too
    unsafe: affected.some(({ r }) => !prices.get(r.id) || prices.get(r.id)!.clamped),
    samples: sampleIds.map((id) => ({
      id,
      name: (names.get(id) ?? '').replace(/\s+/g, ' ').trim(),
      price: affected.find(({ r }) => r.id === id)!.r.price,
      final: prices.get(id)?.final ?? 0,
    })),
  };
}

async function validTarget(scope: DiscountInput['scope'], code: number | null): Promise<void> {
  const ok =
    scope === 'all' ||
    (code !== null &&
      (scope === 'product'
        ? !!(await catalogRepository.getProductSlug(code))
        : scope === 'category'
          ? !!(await catalogRepository.getCategory(code))
          : (await catalogRepository.listBrands()).some((b) => b.code === code)));
  if (!ok) throw new AppError('INVALID_DATA', { message: 'محصول، دسته یا برند انتخاب‌شده پیدا نشد' });
}

function toInput(raw: Record<string, unknown>): DiscountInput {
  const v = parse(discountSchema, raw);
  return {
    scope: v.scope,
    targetCode: v.scope === 'all' ? null : v.target,
    kind: v.kind,
    value: v.value,
    startsAt: v.startsAt ?? new Date(),
    endsAt: v.endsAt,
    label: v.label || null,
    campaignId: v.campaign,
    active: v.active,
    allowLoss: v.allowLoss,
  };
}

export const discountService = {
  async list() {
    await authorize('admin');
    return discountRepository.list();
  },

  async get(id: number) {
    await authorize('admin');
    return discountRepository.get(id);
  },

  async campaigns() {
    await authorize('admin');
    return discountRepository.campaigns();
  },

  /** Preview without saving. */
  async preview(raw: Record<string, unknown>): Promise<DiscountPreview> {
    await authorize('admin');
    const input = toInput(raw);
    await validTarget(input.scope, input.targetCode);
    const { affected, atLoss, samples } = await check(input);
    return { affected, atLoss, samples };
  },

  /**
   * Create (no id) or update. Without «loss allowed» it is refused when it reaches the purchase-price floor on any
   * covered product; with it (the admin's own decision) it is saved and the audit says so.
   */
  async save(id: number | null, raw: Record<string, unknown>, meta: RequestMeta): Promise<number> {
    const admin = await authorize('admin');
    const input = toInput(raw);
    await validTarget(input.scope, input.targetCode);
    if (input.campaignId !== null && !(await discountRepository.getCampaign(input.campaignId)))
      throw new AppError('INVALID_DATA', { message: 'کمپین انتخاب‌شده پیدا نشد' });
    const { unsafe, affected, atLoss } = await check(input);
    if (unsafe && !input.allowLoss) throw new AppError('DISCOUNT_UNSAFE');
    const saved = await withTransaction(async (db) => {
      const newId = id === null ? await discountRepository.insert(input, admin.id, db) : id;
      if (id !== null && !(await discountRepository.update(id, input, db))) throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: id === null ? 'discount.create' : 'discount.update',
          entityType: 'discount',
          entityId: String(newId),
          meta: {
            scope: input.scope,
            target: input.targetCode,
            kind: input.kind,
            value: input.value,
            affected,
            allowLoss: input.allowLoss,
            atLoss,
          },
          ip: meta.ip,
        },
        db,
      );
      return newId;
    });
    pricingService.invalidate();
    return saved;
  },

  async setActive(id: number, active: boolean, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    const row = await discountRepository.get(id);
    if (!row) throw new AppError('NOT_FOUND');
    // switching one back on is a new decision: the safety check runs again
    if (
      !row.allow_loss &&
      active &&
      (await check({ ...toDiscountInput(toDiscount(row)), active: true })).unsafe
    )
      throw new AppError('DISCOUNT_UNSAFE');
    await withTransaction(async (db) => {
      await discountRepository.setActive(id, active, db);
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: active ? 'discount.enable' : 'discount.disable',
          entityType: 'discount',
          entityId: String(id),
          ip: meta.ip,
        },
        db,
      );
    });
    pricingService.invalidate();
  },

  async saveCampaign(id: number | null, raw: Record<string, unknown>, meta: RequestMeta): Promise<number> {
    const admin = await authorize('admin');
    const v = parse(campaignSchema, raw);
    const input: CampaignInput = {
      title: v.title,
      bannerText: v.bannerText,
      endsAt: v.endsAt,
      link: v.link,
      active: v.active,
    };
    const saved = await withTransaction(async (db) => {
      const newId = id === null ? await discountRepository.insertCampaign(input, admin.id, db) : id;
      if (id !== null && !(await discountRepository.updateCampaign(id, input, db)))
        throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: id === null ? 'campaign.create' : 'campaign.update',
          entityType: 'campaign',
          entityId: String(newId),
          meta: { active: input.active },
          ip: meta.ip,
        },
        db,
      );
      return newId;
    });
    pricingService.invalidate();
    return saved;
  },
};

function toDiscountInput(d: Discount): DiscountInput {
  return {
    scope: d.scope,
    targetCode: d.targetCode,
    kind: d.kind,
    value: d.value,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    label: null,
    campaignId: d.campaignId,
    active: d.active,
    allowLoss: d.allowLoss,
  };
}
