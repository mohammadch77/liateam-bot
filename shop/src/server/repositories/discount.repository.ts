import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Discount, DiscountKind, DiscountScope } from '@/lib/pricing/discounts';

/**
 * Our own discounts and campaigns (shop schema), and the discounted prices. The final price comes from
 * public.shop_offer_prices (deploy/shop-db-roles-009-offer-prices.sql), which alone reads the purchase price: this
 * file sends product ids and our manual discounts and gets back the final price and a yes/no «the floor decided».
 */

export type DiscountRow = {
  id: number;
  scope: DiscountScope;
  target_code: number | null;
  kind: DiscountKind;
  value: number;
  starts_at: Date;
  ends_at: Date | null;
  label: string | null;
  campaign_id: number | null;
  active: boolean;
  allow_loss: boolean;
  created_at: Date;
  campaign_active: boolean | null;
  campaign_ends_at: Date | null;
  campaign_title: string | null;
};

export type CampaignRow = {
  id: number;
  title: string;
  banner_text: string;
  ends_at: Date;
  link: string;
  active: boolean;
  created_at: Date;
};

export type DiscountInput = {
  scope: DiscountScope;
  targetCode: number | null;
  kind: DiscountKind;
  value: number;
  startsAt: Date;
  endsAt: Date | null;
  label: string | null;
  campaignId: number | null;
  active: boolean;
  allowLoss: boolean;
};

export type CampaignInput = {
  title: string;
  bannerText: string;
  endsAt: Date;
  link: string;
  active: boolean;
};

/** A visible product as the pricing needs it (no long texts, no purchase price). */
export type PricingRow = {
  id: number;
  price: number;
  category: number[];
  brand_code: number | null;
  first_seen_at: Date;
};

const DISCOUNT_COLS = `d.id::int, d.scope, d.target_code, d.kind, d.value::int, d.starts_at, d.ends_at, d.label,
  d.campaign_id::int, d.active, d.allow_loss, d.created_at, c.active AS campaign_active, c.ends_at AS campaign_ends_at,
  c.title AS campaign_title`;
const CAMPAIGN_COLS = 'id::int, title, banner_text, ends_at, link, active, created_at';

export const toDiscount = (r: DiscountRow): Discount => ({
  id: r.id,
  scope: r.scope,
  targetCode: r.target_code,
  kind: r.kind,
  value: r.value,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  active: r.active,
  allowLoss: r.allow_loss,
  campaignId: r.campaign_id,
  campaignActive: r.campaign_active,
  campaignEndsAt: r.campaign_ends_at,
});

/** Whether deploy/…-009 has been run (until then: no discounts at all, the shop works as before). */
let pricingReady: { ok: boolean; at: number } | null = null;
async function hasOfferFunction(): Promise<boolean> {
  if (pricingReady && (pricingReady.ok || Date.now() - pricingReady.at < 5 * 60_000)) return pricingReady.ok;
  const row = await queryOne<{ ok: boolean }>(
    'discount.offer_function_ready',
    `SELECT to_regprocedure('public.shop_offer_prices(integer[],numeric[],bigint[],boolean[],numeric,numeric,numeric)') IS NOT NULL
        AND has_function_privilege('public.shop_offer_prices(integer[],numeric[],bigint[],boolean[],numeric,numeric,numeric)',
                                   'EXECUTE') AS ok`,
  );
  const ok = !!row?.ok;
  if (!ok && !pricingReady)
    logger.warn('discount.offer_prices_unavailable', {
      reason: 'run deploy/shop-db-roles-009-offer-prices.sql',
    });
  pricingReady = { ok, at: Date.now() };
  return ok;
}

/** Whether deploy/…-012 (the discount mode) is installed; until then step 9's function (mode «excess» only). */
let modeReady: { ok: boolean; at: number } | null = null;
async function hasModeFunction(): Promise<boolean> {
  if (modeReady && (modeReady.ok || Date.now() - modeReady.at < 5 * 60_000)) return modeReady.ok;
  const sig =
    'public.shop_offer_prices_mode(integer[],numeric[],bigint[],boolean[],text,numeric,numeric,numeric)';
  const row = await queryOne<{ ok: boolean }>(
    'discount.mode_function_ready',
    `SELECT to_regprocedure('${sig}') IS NOT NULL AND has_function_privilege('${sig}', 'EXECUTE') AS ok`,
  );
  const ok = !!row?.ok;
  if (!ok && !modeReady)
    logger.warn('discount.mode_function_unavailable', {
      reason: 'run deploy/shop-db-roles-012-offer-prices-mode.sql (until then: the «excess» formula)',
    });
  modeReady = { ok, at: Date.now() };
  return ok;
}

/** How Liateam's discount reaches the customer (admin setting): the one liateam.ir shows, or the excess formula. */
export type DiscountMode = 'liateam' | 'excess';

export const discountRepository = {
  /** Discounts that may still run (switched on, not ended); the service checks start/end against the clock. */
  async live(): Promise<DiscountRow[]> {
    return query<DiscountRow>(
      'discount.live',
      `SELECT ${DISCOUNT_COLS}
         FROM shop_discounts d LEFT JOIN campaigns c ON c.id = d.campaign_id
        WHERE d.active AND (d.ends_at IS NULL OR d.ends_at > now())
        ORDER BY d.id`,
    );
  },

  async list(): Promise<DiscountRow[]> {
    return query<DiscountRow>(
      'discount.list',
      `SELECT ${DISCOUNT_COLS} FROM shop_discounts d LEFT JOIN campaigns c ON c.id = d.campaign_id
        ORDER BY d.active DESC, d.id DESC LIMIT 500`,
    );
  },

  async get(id: number): Promise<DiscountRow | null> {
    return queryOne<DiscountRow>(
      'discount.get',
      `SELECT ${DISCOUNT_COLS} FROM shop_discounts d LEFT JOIN campaigns c ON c.id = d.campaign_id WHERE d.id = $1`,
      [id],
    );
  },

  async insert(d: DiscountInput, by: string, db?: Queryable): Promise<number> {
    const row = await queryOne<{ id: number }>(
      'discount.insert',
      `INSERT INTO shop_discounts
         (scope, target_code, kind, value, starts_at, ends_at, label, campaign_id, active, allow_loss, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::int`,
      [
        d.scope,
        d.targetCode,
        d.kind,
        d.value,
        d.startsAt,
        d.endsAt,
        d.label,
        d.campaignId,
        d.active,
        d.allowLoss,
        by,
      ],
      db,
    );
    return row!.id;
  },

  async update(id: number, d: DiscountInput, db?: Queryable): Promise<boolean> {
    const rows = await query(
      'discount.update',
      `UPDATE shop_discounts SET scope = $2, target_code = $3, kind = $4, value = $5, starts_at = $6, ends_at = $7,
              label = $8, campaign_id = $9, active = $10, allow_loss = $11
        WHERE id = $1 RETURNING id`,
      [
        id,
        d.scope,
        d.targetCode,
        d.kind,
        d.value,
        d.startsAt,
        d.endsAt,
        d.label,
        d.campaignId,
        d.active,
        d.allowLoss,
      ],
      db,
    );
    return rows.length === 1;
  },

  async setActive(id: number, active: boolean, db?: Queryable): Promise<boolean> {
    const rows = await query(
      'discount.set_active',
      'UPDATE shop_discounts SET active = $2 WHERE id = $1 RETURNING id',
      [id, active],
      db,
    );
    return rows.length === 1;
  },

  // ── campaigns ──
  async campaigns(): Promise<CampaignRow[]> {
    return query<CampaignRow>(
      'campaign.list',
      `SELECT ${CAMPAIGN_COLS} FROM campaigns ORDER BY active DESC, ends_at DESC LIMIT 200`,
    );
  },

  /** Running campaigns (switched on, not ended), ending soonest first: the header bar shows the first. */
  async runningCampaigns(): Promise<CampaignRow[]> {
    return query<CampaignRow>(
      'campaign.running',
      `SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE active AND ends_at > now() ORDER BY ends_at, id LIMIT 20`,
    );
  },

  async getCampaign(id: number): Promise<CampaignRow | null> {
    return queryOne<CampaignRow>('campaign.get', `SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE id = $1`, [
      id,
    ]);
  },

  async insertCampaign(c: CampaignInput, by: string, db?: Queryable): Promise<number> {
    const row = await queryOne<{ id: number }>(
      'campaign.insert',
      `INSERT INTO campaigns (title, banner_text, ends_at, link, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::int`,
      [c.title, c.bannerText, c.endsAt, c.link, c.active, by],
      db,
    );
    return row!.id;
  },

  async updateCampaign(id: number, c: CampaignInput, db?: Queryable): Promise<boolean> {
    const rows = await query(
      'campaign.update',
      `UPDATE campaigns SET title = $2, banner_text = $3, ends_at = $4, link = $5, active = $6
        WHERE id = $1 RETURNING id`,
      [id, c.title, c.bannerText, c.endsAt, c.link, c.active],
      db,
    );
    return rows.length === 1;
  },

  // ── prices ──
  /** Every visible product with what the pricing needs (a few hundred rows; the service caches the result). */
  async pricingRows(): Promise<PricingRow[]> {
    return query<PricingRow>(
      'discount.pricing_rows',
      `SELECT p.id, p.price, p.category, p.brand_code, p.first_seen_at
         FROM product_catalog p
        WHERE p.is_sellable AND p.price > 0 AND p.missing_since IS NULL`,
    );
  },

  /**
   * Final prices for these products with our manual discounts (same order as ids; percent and toman per product).
   * Products the database cannot price (no purchase price known) are missing from the result: no discount.
   * null = the function is not installed yet.
   */
  async offerPrices(
    items: ReadonlyArray<{ id: number; percent: number; amount: number; allowLoss: boolean }>,
    rules: { baseMargin: number; cap: number; minMargin: number },
    mode: DiscountMode,
  ): Promise<Map<number, { final: number; clamped: boolean }> | null> {
    if (!(await hasOfferFunction())) return null;
    if (!items.length) return new Map();
    const args = [
      items.map((i) => i.id),
      items.map((i) => i.percent),
      items.map((i) => Math.round(i.amount)),
      items.map((i) => i.allowLoss),
    ];
    const rows = (await hasModeFunction())
      ? await query<{ id: number; final_toman: string; clamped: boolean }>(
          'discount.offer_prices_mode',
          `SELECT id, final_toman, clamped
             FROM public.shop_offer_prices_mode($1::int[], $2::numeric[], $3::bigint[], $4::boolean[], $5, $6, $7, $8)`,
          [...args, mode, rules.baseMargin, rules.cap, rules.minMargin],
        )
      : await query<{ id: number; final_toman: string; clamped: boolean }>(
          'discount.offer_prices',
          `SELECT id, final_toman, clamped
             FROM public.shop_offer_prices($1::int[], $2::numeric[], $3::bigint[], $4::boolean[], $5, $6, $7)`,
          [...args, rules.baseMargin, rules.cap, rules.minMargin],
        );
    return new Map(rows.map((r) => [r.id, { final: Number(r.final_toman), clamped: r.clamped }]));
  },
};
