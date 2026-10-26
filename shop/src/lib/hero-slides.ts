/**
 * Which of Liateam's home-page banners the shop leaves out, and why. The bot stores every banner whose destination is
 * in ITS catalog (a product that is not «missing»); the shop shows only banners whose destination it can sell, so a
 * banner the dashboard counts can be absent from the slider. Each such banner is logged (hero.slide_skipped) — the
 * filter itself is unchanged.
 */
export type HeroSlideFacts = {
  position: number;
  image_url: string;
  target_type: 'product' | 'category';
  target_code: number;
  /** product destination: null when the product is not in the catalog at all */
  product_id: number | null;
  is_sellable: boolean | null;
  price: number | string | null;
  missing_since: Date | string | null;
  /** category destination: null when the category is not in the catalog at all */
  category_code: number | null;
  in_source: boolean | null;
};

export type HeroSkipReason =
  | 'product-not-found'
  | 'product-not-sellable'
  | 'product-zero-price'
  | 'product-missing'
  | 'category-not-found'
  | 'category-not-in-source'
  | 'bad-image';

/** Liateam's own image host only (same rule the slider applies). */
const IMAGE_HOST = /^https:\/\/s3\.liateam\.ir\//;

/** null = the slide is shown. The order of the checks is the order the reason is reported in. */
export function heroSkipReason(r: HeroSlideFacts): HeroSkipReason | null {
  if (r.target_type === 'product') {
    if (r.product_id === null) return 'product-not-found';
    if (!r.is_sellable) return 'product-not-sellable';
    if (!(Number(r.price) > 0)) return 'product-zero-price';
    if (r.missing_since !== null) return 'product-missing';
  } else {
    if (r.category_code === null) return 'category-not-found';
    if (!r.in_source) return 'category-not-in-source';
  }
  return IMAGE_HOST.test(r.image_url) ? null : 'bad-image';
}

type Warn = (msg: string, fields: Record<string, unknown>) => void;

/** Logs one hero.slide_skipped line per dropped slide (position, target, reason — no URLs, no prices). */
export function logSkippedHeroSlides(rows: readonly HeroSlideFacts[], warn: Warn): number {
  let n = 0;
  for (const r of rows) {
    const reason = heroSkipReason(r);
    if (!reason) continue;
    n++;
    warn('hero.slide_skipped', {
      position: r.position,
      target_type: r.target_type,
      target_code: r.target_code,
      reason,
    });
  }
  return n;
}
