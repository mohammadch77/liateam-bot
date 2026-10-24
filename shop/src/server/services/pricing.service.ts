import 'server-only';
import { siteSettingsService } from './site-settings.service';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { bestManual, type Discount, type PricedProduct } from '@/lib/pricing/discounts';
import { onDataChange } from '@/server/cache-events';
import { catalogRepository } from '@/server/repositories/catalog.repository';
import {
  discountRepository,
  toDiscount,
  type CampaignRow,
  type PricingRow,
} from '@/server/repositories/discount.repository';

/**
 * The customer's price of every visible product: Liateam's price minus (the part of Liateam's discount to our
 * account above our base margin) + (our best manual discount), capped, never under the purchase price + the minimum
 * margin. The arithmetic with the purchase price runs in the database (shop_offer_prices); this service only learns
 * the final price. Computed for the whole catalog at once (a few hundred products) and kept until the next discount
 * starts or ends, at most 30 s, so an ended discount disappears by itself and a new Liateam price is used at once.
 */

export type Offer = {
  /** what the customer pays (toman) */
  final: number;
  /** Liateam's price, shown struck through */
  old: number;
  campaignId: number | null;
};

type State = {
  offers: Map<number, Offer>;
  rows: PricingRow[];
  /** running campaigns, ending soonest first */
  campaigns: CampaignRow[];
  until: number;
};

const MAX_AGE_MS = 30_000;
let state: State | null = null;
let loading: Promise<State> | null = null;
// the bot changed prices / stock (revalidate call): compute again on the next request
onDataChange(() => (state = null));

export function pricingRules() {
  const c = getConfig();
  return {
    baseMargin: c.OUR_BASE_MARGIN_PERCENT,
    cap: c.DISCOUNT_MAX_PERCENT,
    minMargin: c.DISCOUNT_MIN_MARGIN_PERCENT,
  };
}

/** category code → itself and every ancestor (a discount on a parent category covers its whole subtree). */
async function ancestorsOf(): Promise<(codes: readonly number[]) => number[]> {
  const parent = new Map((await catalogRepository.listCategories()).map((c) => [c.code, c.parent_code]));
  return (codes) => {
    const out = new Set<number>();
    for (const code of codes) {
      for (let c: number | null | undefined = code, n = 0; c != null && n < 10 && !out.has(c); n++) {
        out.add(c);
        c = parent.get(c);
      }
    }
    return [...out];
  };
}

/** The next moment a discount or campaign starts or ends (the cache must not outlive it). */
function nextChange(discounts: readonly Discount[], campaigns: readonly CampaignRow[], now: number): number {
  let next = now + MAX_AGE_MS;
  const consider = (d: Date | null | undefined) => {
    const t = d?.getTime();
    if (t && t > now && t < next) next = t;
  };
  for (const d of discounts) {
    consider(d.startsAt);
    consider(d.endsAt);
    consider(d.campaignEndsAt);
  }
  for (const c of campaigns) consider(c.ends_at);
  return next;
}

/** Products the database could not price get no discount (and are logged once per load, without numbers). */
async function load(): Promise<State> {
  const now = new Date();
  const [discountRows, rows, campaigns, ancestors] = await Promise.all([
    discountRepository.live(),
    discountRepository.pricingRows(),
    discountRepository.runningCampaigns(),
    ancestorsOf(),
  ]);
  const discounts = discountRows.map(toDiscount);
  const items = rows.map((r) => {
    const product: PricedProduct = {
      id: r.id,
      price: r.price,
      categories: ancestors(r.category),
      brandCode: r.brand_code,
    };
    return { row: r, manual: bestManual(product, discounts, now) };
  });
  const prices = await discountRepository.offerPrices(
    items.map(({ row, manual }) => ({
      id: row.id,
      percent: manual.percent,
      amount: manual.amount,
      allowLoss: manual.allowLoss,
    })),
    pricingRules(),
    await siteSettingsService.discountMode(),
  );
  const offers = new Map<number, Offer>();
  let unpriced = 0;
  for (const { row, manual } of items) {
    const p = prices?.get(row.id);
    if (!p) {
      if (prices) unpriced++;
      continue;
    }
    if (p.final < row.price)
      offers.set(row.id, { final: p.final, old: row.price, campaignId: manual.campaignId });
  }
  if (unpriced) logger.warn('pricing.unpriced_products', { count: unpriced });
  return { offers, rows, campaigns, until: nextChange(discounts, campaigns, now.getTime()) };
}

async function current(): Promise<State> {
  if (state && Date.now() < state.until) return state;
  loading ??= load()
    .then((s) => (state = s))
    .finally(() => (loading = null));
  return loading;
}

const EMPTY: State = { offers: new Map(), rows: [], campaigns: [], until: 0 };

/** Never fails a page: without the tables or the function the shop simply shows Liateam's prices. */
async function safeCurrent(): Promise<State> {
  try {
    return await current();
  } catch (e) {
    logger.warn('pricing.unavailable', { err: e });
    return EMPTY;
  }
}

export const pricingService = {
  /** id → the offer (only products with a real discount). */
  async offers(): Promise<Map<number, Offer>> {
    return (await safeCurrent()).offers;
  },

  /** The visible products with a discount, for the offers page (newest first; the service sorts as asked). */
  async discounted(): Promise<Array<PricingRow & Offer>> {
    const s = await safeCurrent();
    return s.rows.filter((r) => s.offers.has(r.id)).map((r) => ({ ...r, ...s.offers.get(r.id)! }));
  },

  /** The campaign of the header bar and the offers countdown (running, ends soonest), or null. */
  async campaign(): Promise<CampaignRow | null> {
    return (await safeCurrent()).campaigns[0] ?? null;
  },

  async campaigns(): Promise<CampaignRow[]> {
    return (await safeCurrent()).campaigns;
  },

  /** After an admin change: the next request computes again. */
  invalidate(): void {
    state = null;
  },
};
