import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import { BESTSELLER_TABS } from '@/lib/bestsellers';
import { brandPath, brandsPath, categoryPath, categoriesPath, offersPath, productPath, shopPath } from '@/lib/urls';
import { toAppError } from '@/lib/errors';
import { priceRange } from '@/lib/price-range';
import { heroSkipReason, logSkippedHeroSlides } from '@/lib/hero-slides';
import { logger } from '@/lib/logger';
import { editDistance, normalizeSearch, searchWords } from '@/lib/search/normalize';
import {
  catalogRepository,
  type CategoryRow,
  type ProductContentRows,
  type ProductDetailRow,
  type ProductRow,
  type ProductSort,
  type SearchTerms,
} from '@/server/repositories/catalog.repository';
import { reviewRepository, type SiteReviewRow } from '@/server/repositories/review.repository';
import { pricingService, type Offer } from '@/server/services/pricing.service';
import type { ProductCardData, StockState } from '@/ui';

/** Catalog display policy. */
export const CATALOG_POLICY = {
  pageSize: 24, // 2 / 3 / 4 columns → full rows on phone, tablet and laptop
  limitedStockBelow: 5, // «موجودی محدود» badge
  maxPage: 500,
  maxQueryLength: 80,
} as const;

export const SORT_OPTIONS: ReadonlyArray<{ value: ProductSort; label: string }> = [
  { value: 'relevance', label: 'پیشنهادی' },
  { value: 'newest', label: 'جدیدترین' },
  { value: 'price_asc', label: 'ارزان‌ترین' },
  { value: 'price_desc', label: 'گران‌ترین' },
];

export type OfferSort = 'discount' | 'cheapest' | 'newest';
export const OFFER_SORTS: ReadonlyArray<{ value: OfferSort; label: string }> = [
  { value: 'discount', label: 'بیشترین تخفیف' },
  { value: 'cheapest', label: 'ارزان‌ترین' },
  { value: 'newest', label: 'جدیدترین' },
];

export type Category = { code: number; name: string; parentCode: number | null; count: number; href: string };

export const SUGGEST_LIMITS = { products: 7, categories: 2, minLength: 2, maxLength: 60 } as const;

/** Search-as-you-type response (also the JSON of GET /api/search/suggest). */
export type Suggestions = {
  query: string;
  /** normalised query words and their spelling corrections, for highlighting */
  words: string[];
  products: Array<{
    href: string;
    name: string;
    brand: string | null;
    imageUrl: string | null;
    priceToman: number;
    inStock: boolean;
  }>;
  categories: Array<{ name: string; href: string; parent: string | null }>;
  /** all matching products (the results page shows them) */
  total: number;
};

export type ProductView = ProductCardData & {
  id: number;
  /** the supplier's brand (from the product page); null until the bot has read it */
  brandName: string | null;
  categories: Array<{ code: number; name: string; href: string }>;
  stockCount: number;
  updatedAt: Date;
};

/**
 * Render guard: the bot decodes HTML entities before storing, but a raw one that slips through (older rows, a new
 * entity) is never shown as «&zwnj;»: the ZWNJ-like ones become a ZWNJ, a few common ones their character, the rest
 * is dropped. Plain text in, plain text out (rendered escaped by React; nothing here can produce markup that runs).
 */
const ENTITY_TEXT: Record<string, string> = {
  zwnj: '\u200c',
  shy: '\u200c',
  not: '\u200c',
  nbsp: ' ',
  amp: '&',
  quot: '"',
  bull: '•',
  middot: '·',
  hellip: '…',
  ndash: '–',
  rsquo: '’',
  laquo: '«',
  raquo: '»',
};
export function withoutEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi,
    (_, e: string) => ENTITY_TEXT[e.toLowerCase()] ?? '',
  );
}

/** The stored description (plain text from the sync bot) as typed blocks: never rendered as HTML. */
export type DescriptionBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] };

/** "## " heading, "• " list item, blank line between blocks (format written by the bot's product-details.mjs). */
export function descriptionBlocks(text: string | null): DescriptionBlock[] {
  if (!text) return [];
  const blocks: DescriptionBlock[] = [];
  for (const chunk of withoutEntities(text).split(/\n{2,}/)) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const last = blocks.at(-1);
      if (line.startsWith('## ')) blocks.push({ kind: 'heading', text: line.slice(3) });
      else if (line.startsWith('• ')) {
        if (last?.kind === 'list') last.items.push(line.slice(2));
        else blocks.push({ kind: 'list', items: [line.slice(2)] });
      } else if (last?.kind === 'paragraph' && lines.indexOf(line) > 0) last.lines.push(line);
      else blocks.push({ kind: 'paragraph', lines: [line] });
    }
  }
  return blocks;
}

// ── product page: rich sections ──
export const PRODUCT_REVIEWS_SHOWN = 20;

/** One review as the product page shows it; `source` says where it was written. */
export type ReviewView = {
  source: 'liateam' | 'site';
  author: string;
  /** 1-5 stars (Liateam's 1-10 halved, rounded), null = no score */
  stars: number | null;
  body: string;
  reply: string | null;
  createdAt: Date | null;
};

/** The product page's sections. Empty ones are hidden by the page (no empty tab). */
export type ProductContent = {
  /** main photo first, then the gallery in Liateam's order; Liateam's image host only (served by our optimiser) */
  images: Array<{ url: string; alt: string }>;
  summary: string[];
  features: string[];
  /** ArvanCloud player URL (re-checked here), shown in a sandboxed iframe */
  videoEmbedUrl: string | null;
  /** % of buyers who recommend it */
  recommendPercent: number | null;
  attributes: Array<{ key: string; value: string }>;
  howToUse: string[];
  faqs: Array<{ question: string; answer: string }>;
  reviews: ReviewView[];
  /** reviews on Liateam + approved ones on our site */
  reviewsTotal: number;
  /** «۱۵ میلی‌لیتر» / «۷۵ گرم», or null */
  size: string | null;
  country: string | null;
  /** shelf life after production, in months */
  expireMonths: number | null;
  /** Liateam's product colour (#rrggbb): the gallery backdrop tint */
  color: string | null;
  concerns: string[];
};

const UNIT_FA = { ml: 'میلی‌لیتر', g: 'گرم' } as const;
/** 15 + 'ml' → «۱۵ میلی‌لیتر» (whole numbers without decimals) */
export function sizeLabel(value: string | number | null, unit: 'ml' | 'g' | null): string | null {
  const n = Number(value);
  if (!unit || !(unit in UNIT_FA) || !Number.isFinite(n) || n <= 0) return null;
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(n)} ${UNIT_FA[unit]}`;
}

const VIDEO_PLAYER =
  /^https:\/\/player\.arvancloud\.ir\/index\.html\?config=https:\/\/[a-z0-9-]+\.arvanvod\.ir\/[\w/.-]+\.json$/i;
const IMAGE_HOST = /^https:\/\/s3\.liateam\.ir\//;
const textLines = (s: string | null) =>
  withoutEntities(s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /[\p{L}\p{N}]/u.test(l)); // "." placeholders are not content

function toContent(row: ProductDetailRow, c: ProductContentRows, site: SiteReviewRow[]): ProductContent {
  const reviews: ReviewView[] = [
    ...site.map((r) => ({
      source: 'site' as const,
      author: r.author_name ?? 'کاربر',
      stars: r.rating,
      body: r.body,
      reply: null,
      createdAt: r.created_at,
    })),
    ...c.reviews.map((r) => ({
      source: 'liateam' as const,
      author: r.author ?? 'خریدار',
      stars: r.rating ? Math.max(1, Math.round(r.rating / 2)) : null,
      body: withoutEntities(r.body),
      reply: r.reply && withoutEntities(r.reply),
      createdAt: r.created_at,
    })),
  ].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  const summary = textLines(row.summary);
  const seen = new Set<string>();
  const images = [...(row.image_url ? [{ url: row.image_url, alt: null }] : []), ...c.images].flatMap(
    (img, i) => {
      if (!IMAGE_HOST.test(img.url) || seen.has(img.url)) return [];
      seen.add(img.url);
      return [
        { url: img.url, alt: i === 0 ? clean(row.name) : (img.alt ?? `${clean(row.name)} — تصویر ${i + 1}`) },
      ];
    },
  );
  return {
    images,
    summary,
    // Liateam's features usually repeat the summary lines; show them once
    features: row.features.map(withoutEntities).filter((f) => !summary.includes(f.trim())),
    videoEmbedUrl: row.video_embed_url && VIDEO_PLAYER.test(row.video_embed_url) ? row.video_embed_url : null,
    recommendPercent: row.rating_value,
    attributes: c.attributes.map((a) => ({ key: withoutEntities(a.key), value: withoutEntities(a.value) })),
    howToUse: textLines(row.how_to_use),
    faqs: c.faqs.map((f) => ({ question: withoutEntities(f.question), answer: withoutEntities(f.answer) })),
    reviews: reviews.slice(0, PRODUCT_REVIEWS_SHOWN),
    reviewsTotal: (row.reviews_total ?? c.reviews.length) + site.length,
    size: sizeLabel(row.measurement_value, row.measurement_unit),
    country: row.origin_country ? clean(row.origin_country) : null,
    expireMonths: row.expire_months,
    color: row.color && /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : null,
    concerns: c.concerns.map(clean).filter(Boolean),
  };
}

export type Listing = {
  items: ProductView[];
  total: number;
  page: number;
  totalPages: number;
  params: ListParams;
  /** lowest and highest final price in the shop (the price filter's slider ends) */
  priceBounds?: { lo: number; hi: number };
  /** category code → products it would show under the current filters (the category choice left out) */
  facets?: Map<number, number>;
};

// ── query-string parsing (URL input is untrusted) ──
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const listParamsSchema = z
  .object({
    // a page past the end is clamped (then redirected to the real last page by the listing), not turned into page 1
    page: z
      .preprocess(
        one,
        z.coerce
          .number()
          .int()
          .min(1)
          .transform((n) => Math.min(n, CATALOG_POLICY.maxPage))
          .catch(1),
      )
      .default(1),
    sort: z
      .preprocess(one, z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).catch('relevance'))
      .default('relevance'),
    inStock: z.preprocess(one, z.enum(['1']).optional().catch(undefined)),
    cat: z.preprocess(one, z.coerce.number().int().positive().optional().catch(undefined)),
    q: z.preprocess(one, z.string().trim().max(CATALOG_POLICY.maxQueryLength).optional().catch(undefined)),
    /** a home «پرفروش‌ترین‌ها» tab: its categories (src/lib/bestsellers.ts) when no single category is chosen */
    group: z.preprocess(one, z.enum(['skin', 'makeup', 'scent', 'hair']).optional().catch(undefined)),
    /** price filter on the final price (toman; Persian or Latin digits, separators allowed) */
    min: z.preprocess(one, z.unknown()),
    max: z.preprocess(one, z.unknown()),
  })
  .transform(({ min, max, ...rest }) => ({ ...rest, ...priceRange(min, max) }));
export type ListParams = z.infer<typeof listParamsSchema>;
export type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseListParams(raw: RawSearchParams): ListParams {
  return listParamsSchema.parse(raw);
}

// ── search: spelling tolerance ──
/**
 * The catalog's own words (names + brands, normalised), cached for 10 minutes: misspelt query words are
 * corrected against them, so «رمل» also finds «ریمل» — trigrams alone are too weak for short Persian words.
 */
const VOCAB_TTL_MS = 10 * 60_000;
let vocab: { words: string[]; at: number } | null = null;
async function vocabulary(): Promise<string[]> {
  if (vocab && Date.now() - vocab.at < VOCAB_TTL_MS) return vocab.words;
  try {
    vocab = { words: await catalogRepository.searchVocabulary(), at: Date.now() };
  } catch (e) {
    // search still works without corrections
    logger.warn('catalog.search_vocabulary_failed', { err: e });
    vocab = { words: vocab?.words ?? [], at: Date.now() };
  }
  return vocab.words;
}

/** Up to 5 catalog words within 1 edit (2 from 6 letters) of a word that occurs nowhere in the catalog. */
function corrections(word: string, words: readonly string[]): string[] {
  if (word.length < 3 || /^\d+$/.test(word) || words.some((v) => v.includes(word))) return [];
  const max = word.length >= 6 ? 2 : 1;
  return words
    .map((v) => ({ v, d: editDistance(word, v, max) }))
    .filter((x) => x.d <= max)
    .sort((a, b) => a.d - b.d || a.v.length - b.v.length)
    .slice(0, 5)
    .map((x) => x.v);
}

/** The normalised query, its words and their spelling corrections; null for an empty query. */
async function searchTerms(q: string | undefined): Promise<SearchTerms | null> {
  const words = searchWords(q);
  if (!words.length) return null;
  const known = await vocabulary();
  return {
    text: normalizeSearch(q ?? ''),
    words: words.map((word) => ({ word, alts: corrections(word, known) })),
  };
}

// ── mapping DB rows → view models ──
/** Supplier names sometimes carry doubled or stray spaces («سرم  تخصصی»). */
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function stockState(stock: number): StockState {
  if (stock <= 0) return 'out';
  return stock < CATALOG_POLICY.limitedStockBelow ? 'limited' : 'in';
}

type Offers = ReadonlyMap<number, Offer>;

function toView(r: ProductRow, names: Map<number, string>, offers: Offers): ProductView {
  const categories = r.category
    .map((code) => ({ code, name: names.get(code) }))
    .filter((c): c is { code: number; name: string } => !!c.name)
    .map((c) => ({ ...c, href: categoryPath(c.code, c.name) }));
  return {
    id: r.id,
    href: productPath(r.id, clean(r.name), r.slug_en),
    name: clean(r.name),
    brandName: r.brand,
    // card label: the brand when the bot has read it, otherwise the main category
    brand: r.brand ?? categories[0]?.name ?? null,
    imageUrl: r.image_url,
    // our discount (pricing.service): Liateam's price struck through, the discounted one in front
    priceToman: offers.get(r.id)?.final ?? r.price,
    oldPriceToman: offers.has(r.id) ? r.price : null,
    stock: stockState(r.stock),
    stockCount: r.stock,
    categories,
    updatedAt: r.updated_at,
  };
}

const toCategory = (c: CategoryRow): Category => ({
  code: c.code,
  name: clean(c.name),
  parentCode: c.parent_code,
  count: c.product_count,
  href: categoryPath(c.code, clean(c.name)),
});

async function categoryNames(): Promise<{ list: Category[]; names: Map<number, string> }> {
  const list = (await catalogRepository.listCategories()).map(toCategory);
  return { list, names: new Map(list.map((c) => [c.code, c.name])) };
}

async function listing(
  params: ListParams,
  extra: { categories?: number[]; brandCode?: number; facetWithin?: number } = {},
): Promise<Listing> {
  const search = (await searchTerms(params.q)) ?? undefined;
  const group = params.group ? BESTSELLER_TABS.find((t) => t.key === params.group)?.categories : undefined;
  const categories = extra.categories ?? (params.cat ? [params.cat] : (group ?? undefined)) ?? undefined;
  // the price filter and the price sorts use what the customer pays (after discounts), from the pricing service
  const finals = await pricingService.finalPrices();
  const byPrice = [...finals.byId.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const priced = params.min !== undefined || params.max !== undefined;
  const ids = priced
    ? byPrice
        .filter(
          ([, f]) =>
            (params.min === undefined || f >= params.min) && (params.max === undefined || f <= params.max),
        )
        .map(([id]) => id)
    : undefined;
  const [{ names }, first, offers, facets] = await Promise.all([
    categoryNames(),
    catalogRepository.listProducts({
      categories,
      search,
      inStockOnly: params.inStock === '1',
      brandCode: extra.brandCode,
      ids,
      priceOrder:
        params.sort === 'price_asc' || params.sort === 'price_desc' ? byPrice.map(([id]) => id) : undefined,
      sort: params.sort,
      limit: CATALOG_POLICY.pageSize,
      offset: (params.page - 1) * CATALOG_POLICY.pageSize,
    }),
    pricingService.offers(),
    catalogRepository
      .facetCounts({
        search,
        inStockOnly: params.inStock === '1',
        brandCode: extra.brandCode,
        ids,
        within: extra.facetWithin,
      })
      .catch(() => undefined),
  ]);
  const { rows } = first;
  let { total } = first;
  // a page past the end has no rows, and the window count then reports 0: ask page 1 for the real total, so the
  // listing page can send the visitor to the last page
  if (!rows.length && params.page > 1) {
    total = (
      await catalogRepository.listProducts({
        categories,
        search,
        inStockOnly: params.inStock === '1',
        brandCode: extra.brandCode,
        ids,
        sort: params.sort,
        limit: 1,
        offset: 0,
      })
    ).total;
  }
  return {
    items: rows.map((r) => toView(r, names, offers)),
    facets,
    total,
    page: params.page,
    totalPages: Math.max(1, Math.ceil(total / CATALOG_POLICY.pageSize)),
    params,
    priceBounds: { lo: finals.lo, hi: finals.hi },
  };
}

export type BrandView = {
  code: number;
  name: string;
  latin: string | null;
  slug: string;
  href: string;
  count: number;
  /** served by our own route (/api/brand-logo/<code>), never from the supplier's host */
  logoUrl: string | null;
  imageUrl: string | null;
  /** up to three product photos of the brand (the phone / tablet brand cards) */
  thumbs: string[];
};

const BRAND_LOGO = /^https:\/\/s3\.liateam\.ir\/[\w/.%-]+\.(?:svg|png|jpe?g|webp)$/i;

/** Brands with something to sell, in Liateam's order (one query per request). */
const brandList = cache(async (): Promise<BrandView[]> =>
  (await catalogRepository.listBrands()).map((b) => ({
    code: b.code,
    name: clean(b.name),
    latin: b.latin_name ? clean(b.latin_name) : null,
    slug: b.slug,
    href: brandPath(b.slug),
    count: b.product_count,
    logoUrl: b.logo_url && BRAND_LOGO.test(b.logo_url) ? `/api/brand-logo/${b.code}` : null,
    imageUrl: b.image_url,
    thumbs: b.image_urls ?? [],
  })),
);

export type HeroSlide = {
  href: string;
  /** what the slide leads to (our product / category name; Liateam's own slide labels are internal) */
  label: string;
  image: string;
  portrait: string | null;
  color: string | null;
};

const LIATEAM_IMAGE = /^https:\/\/s3\.liateam\.ir\//;

/**
 * The hero slides, ready to link: products by their English slug, categories by their page. Never fails the home
 * page: without the table (bot not updated, grant 007 not run) there are simply no slides and the static hero shows.
 */
async function loadHeroSlides(): Promise<HeroSlide[]> {
  try {
    const all = await catalogRepository.listHeroSlides();
    // banners the shop cannot show are logged (the bot counts them, the slider does not)
    logSkippedHeroSlides(all, (msg, fields) => logger.warn(msg, fields));
    const rows = all.filter((r) => heroSkipReason(r) === null);
    return rows.map((r) => ({
      href:
        r.target_type === 'product'
          ? productPath(r.target_code, r.product_name, r.slug_en)
          : categoryPath(r.target_code, clean(r.category_name ?? '')),
      label: clean((r.target_type === 'product' ? r.product_name : r.category_name) ?? ''),
      image: r.image_url,
      portrait: r.portrait_url && LIATEAM_IMAGE.test(r.portrait_url) ? r.portrait_url : null,
      color: r.color && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : null,
    }));
  } catch (e) {
    logger.warn('catalog.hero_slides_unavailable', { err: e });
    return [];
  }
}

export const RELATED_LIMIT = 4;

/**
 * «محصولات مرتبط»: up to four products in stock — the same category first, then the same brand, then the
 * best-selling ones — never the product itself and never twice.
 */
async function relatedProducts(
  id: number,
  category: number | null,
  brand: number | null,
): Promise<ProductRow[]> {
  const out: ProductRow[] = [];
  const seen = new Set([id]);
  const take = (rows: readonly ProductRow[]) => {
    for (const r of rows) {
      if (out.length >= RELATED_LIMIT) return;
      if (seen.has(r.id) || r.stock <= 0) continue;
      seen.add(r.id);
      out.push(r);
    }
  };
  const base = {
    excludeId: id,
    inStockOnly: true,
    sort: 'relevance' as const,
    limit: RELATED_LIMIT + 4,
    offset: 0,
  };
  if (category !== null)
    take((await catalogRepository.listProducts({ ...base, categories: [category] })).rows);
  if (out.length < RELATED_LIMIT && brand !== null)
    take((await catalogRepository.listProducts({ ...base, brandCode: brand })).rows);
  if (out.length < RELATED_LIMIT) {
    // imported here: the best-seller service itself builds on this one
    const { bestsellerService } = await import('./bestseller.service');
    const best = (await bestsellerService.tab('all')).map((b) => b.id).filter((x) => !seen.has(x));
    if (best.length) {
      const rows = await catalogRepository.productsByIds(best.slice(0, RELATED_LIMIT + 4));
      const order = new Map(best.map((x, i) => [x, i]));
      take([...rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
    }
  }
  return out;
}

export const catalogService = {
  async home() {
    const [{ list }, inStock, heroSlides, offers] = await Promise.all([
      categoryNames(),
      // the static hero's product (when Liateam's slides are unavailable)
      catalogRepository.listProducts({ sort: 'price_desc', limit: 10, offset: 0, inStockOnly: true }),
      loadHeroSlides(),
      pricingService.offers(),
    ]);
    const names = new Map(list.map((c) => [c.code, c.name]));
    const topCategories = list.filter((c) => c.parentCode === null || !names.has(c.parentCode)).slice(0, 8);
    const [covers, rail, campaign] = await Promise.all([
      catalogRepository.categoryCovers(topCategories.map((c) => c.code)),
      this.offers({ sort: 'discount', page: 1, limit: 8 }),
      pricingService.campaign(),
    ]);
    return {
      offers: rail.items,
      offersCampaign: campaign ? { title: campaign.title, endsAt: campaign.ends_at.toISOString() } : null,
      categories: topCategories.map((c) => ({ ...c, imageUrl: covers.get(c.code) ?? null })),
      featuredHero: inStock.rows.find((r) => r.image_url) ?? null,
      /** the hero chip's price: discounted like everywhere else */
      featuredHeroPrice: ((h) => (h ? (offers.get(h.id)?.final ?? h.price) : 0))(
        inStock.rows.find((r) => r.image_url),
      ),
      heroSlides,
    };
  },

  /** Category page: the category, its sub-categories, and one page of its products. */
  async category(code: number, params: ListParams) {
    const category = await catalogRepository.getCategory(code);
    if (!category) return null;
    const { list } = await categoryNames();
    const children = list.filter((c) => c.parentCode === code);
    // a chosen sub-category narrows the list; it must really be a child of this category
    const sub = params.cat && children.some((c) => c.code === params.cat) ? params.cat : undefined;
    const result = await listing({ ...params, cat: sub }, { categories: [sub ?? code], facetWithin: code });
    const parent = category.parent_code ? (list.find((c) => c.code === category.parent_code) ?? null) : null;
    // a sub-category without its own sub-categories: its sisters, so a visitor can move across at once
    const siblings = parent && !children.length ? list.filter((c) => c.parentCode === parent.code) : [];
    return { category: toCategory(category), parent, children, siblings, listing: result };
  },

  brands: brandList,

  /** Brand page: the brand, one page of its products, and the categories it has products in (with its counts). */
  async brand(slug: string, params: ListParams) {
    const brand = (await brandList()).find((b) => b.slug === slug);
    if (!brand) return null;
    const [{ list }, counts] = await Promise.all([
      categoryNames(),
      catalogRepository.brandCategoryCounts(brand.code),
    ]);
    const categories = list
      .filter((c) => c.parentCode === null && counts.has(c.code))
      .map((c) => ({ ...c, count: counts.get(c.code) ?? 0 }));
    const cat = params.cat && categories.some((c) => c.code === params.cat) ? params.cat : undefined;
    const result = await listing({ ...params, cat }, { brandCode: brand.code });
    return { brand, categories, listing: result };
  },

  /** Name search; with `browseAll` and no query it lists the whole catalog (still filterable/sortable). */
  async search(params: ListParams, opts: { browseAll?: boolean } = {}) {
    const { list } = await categoryNames();
    const hasQuery = searchWords(params.q).length > 0;
    const result: Listing =
      hasQuery || opts.browseAll
        ? await listing(params)
        : { items: [], total: 0, page: 1, totalPages: 1, params };
    return { listing: result, categories: list };
  },

  async product(id: number) {
    const row = await catalogRepository.getProduct(id);
    if (!row) return null;
    const [{ list, names }, offers] = await Promise.all([categoryNames(), pricingService.offers()]);
    const product = toView(row, names, offers);
    // breadcrumb: root → … → the product's main category (guarded against a cyclic tree)
    const byCode = new Map(list.map((c) => [c.code, c]));
    const trail: Category[] = [];
    for (let c = byCode.get(product.categories[0]?.code ?? -1); c && trail.length < 6;) {
      trail.unshift(c);
      c = c.parentCode !== null ? byCode.get(c.parentCode) : undefined;
    }
    const related = await relatedProducts(id, product.categories[0]?.code ?? null, row.brand_code).catch(
      (e) => {
        logger.warn('catalog.related_unavailable', { code: toAppError(e).code });
        return [] as ProductRow[];
      },
    );
    const [content, siteReviews, brands] = await Promise.all([
      catalogRepository.getProductContent(id),
      reviewRepository.approvedFor(id, PRODUCT_REVIEWS_SHOWN),
      brandList().catch(() => [] as BrandView[]),
    ]);
    const brand = brands.find((b) => b.code === row.brand_code) ?? null;
    return {
      product,
      /** the brand's page, when the brand has one (products to sell) */
      brand: brand ? { name: brand.name, href: brand.href } : null,
      description: descriptionBlocks(row.description),
      content: toContent(row, content, siteReviews),
      trail,
      related: related.map((r) => toView(r, names, offers)),
    };
  },

  /**
   * «تخفیفات ویژه»: every visible product with a discount (passed-through or ours), sorted (largest discount,
   * cheapest, newest), optionally only one campaign's, one page of it. `limit` overrides the page size (home rail).
   */
  async offers(q: { sort: OfferSort; page: number; campaign?: number; limit?: number }) {
    const [all, { names }, campaigns] = await Promise.all([
      pricingService.discounted(),
      categoryNames(),
      pricingService.campaigns(),
    ]);
    const chosen = q.campaign !== undefined ? all.filter((r) => r.campaignId === q.campaign) : all;
    const off = (r: { final: number; old: number }) => (r.old - r.final) / r.old;
    const sorted = [...chosen].sort((a, b) =>
      q.sort === 'cheapest'
        ? a.final - b.final || a.id - b.id
        : q.sort === 'newest'
          ? b.first_seen_at.getTime() - a.first_seen_at.getTime() || b.id - a.id
          : off(b) - off(a) || a.final - b.final || a.id - b.id,
    );
    const size = q.limit ?? CATALOG_POLICY.pageSize;
    const totalPages = Math.max(1, Math.ceil(sorted.length / size));
    const page = Math.min(Math.max(1, q.page), totalPages);
    const ids = sorted.slice((page - 1) * size, page * size).map((r) => r.id);
    const [rows, offers] = await Promise.all([catalogRepository.productsByIds(ids), pricingService.offers()]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      items: ids.flatMap((id) => {
        const r = byId.get(id);
        return r ? [toView(r, names, offers)] : [];
      }),
      total: sorted.length,
      page,
      totalPages,
      /** campaigns that have discounted products now (the filter chips) */
      campaigns: campaigns.filter((c) => all.some((r) => r.campaignId === c.id)),
    };
  },

  /** Canonical address of a category (for the URL check before rendering), or null if unknown. */
  categoryRef: cache(async (code: number): Promise<{ href: string } | null> => {
    const c = await catalogRepository.getCategory(code);
    return c ? { href: categoryPath(c.code, clean(c.name)) } : null;
  }),

  /** Canonical address of a visible product, or null (not found / no longer sold). */
  productRef: cache(async (id: number): Promise<{ href: string } | null> => {
    const p = await catalogRepository.getProduct(id);
    return p ? { href: productPath(p.id, clean(p.name), p.slug_en) } : null;
  }),

  /**
   * Search-as-you-type: the best few products (same ranking as the results page) and matching categories.
   * The response is an explicit, minimal shape — nothing else from the catalog leaves the server.
   */
  async suggest(q: string): Promise<Suggestions> {
    const terms = await searchTerms(q);
    if (!terms) return { query: q, words: [], products: [], categories: [], total: 0 };
    const [{ list, names }, { rows, total }, offers] = await Promise.all([
      categoryNames(),
      catalogRepository.listProducts({
        search: terms,
        sort: 'relevance',
        limit: SUGGEST_LIMITS.products,
        offset: 0,
      }),
      pricingService.offers(),
    ]);
    const all = terms.words.flatMap((w) => [w.word, ...w.alts]);
    const categories = list
      .filter((c) =>
        terms.words.every((w) => [w.word, ...w.alts].some((x) => normalizeSearch(c.name).includes(x))),
      )
      .slice(0, SUGGEST_LIMITS.categories)
      .map((c) => ({
        name: c.name,
        href: c.href,
        parent: c.parentCode !== null ? (names.get(c.parentCode) ?? null) : null,
      }));
    return {
      query: q,
      words: all,
      total,
      categories,
      products: rows.map((r) => {
        const v = toView(r, names, offers);
        return {
          href: v.href,
          name: v.name,
          brand: v.brandName,
          imageUrl: v.imageUrl ?? null,
          priceToman: v.priceToman,
          inStock: r.stock > 0,
        };
      }),
    };
  },

  /** Visible products by id as cards (discounted prices included); unknown / no longer sold ids are left out. */
  async productViews(ids: readonly number[]): Promise<Map<number, ProductView>> {
    const [rows, { names }, offers] = await Promise.all([
      catalogRepository.productsByIds([...new Set(ids)]),
      categoryNames(),
      pricingService.offers(),
    ]);
    return new Map(rows.map((r) => [r.id, toView(r, names, offers)]));
  },

  /** id → name of every visible product (the admin's product picker). */
  async productNames(): Promise<Array<{ id: number; name: string }>> {
    return (await catalogRepository.productNames()).map((p) => ({ id: p.id, name: clean(p.name) }));
  },

  /** The public pages a sitemap lists: home, shop, offers, brands, every category, brand and product. */
  async sitemapEntries(): Promise<Array<{ path: string; lastModified?: Date }>> {
    const [products, { list }, brands] = await Promise.all([
      catalogRepository.sitemapProducts(),
      categoryNames(),
      brandList(),
    ]);
    return [
      ...['/', shopPath(), offersPath(), brandsPath(), categoriesPath()].map((path) => ({ path })),
      ...list.map((c) => ({ path: c.href })),
      ...brands.map((b) => ({ path: b.href })),
      ...products.map((p) => ({
        path: productPath(p.id, clean(p.name), p.slug_en),
        lastModified: p.updated_at,
      })),
    ];
  },

  /** Every category with a cover picture (a product of its subtree: in stock and newest first; null when none). */
  async categoriesWithCovers(): Promise<Array<Category & { imageUrl: string | null }>> {
    const { list } = await categoryNames();
    const covers = await catalogRepository.categoryCovers(list.map((c) => c.code));
    return list.map((c) => ({ ...c, imageUrl: covers.get(c.code) ?? null }));
  },

  async allCategories(): Promise<Category[]> {
    return (await categoryNames()).list;
  },

  /** The header's category menu: top-level categories in Liateam's order, each with its sub-categories and a cover. */
  async menu(): Promise<Array<Category & { children: Category[]; imageUrl: string | null }>> {
    const { list } = await categoryNames();
    const roots = list.filter((c) => c.parentCode === null);
    const covers = await catalogRepository.categoryCovers(roots.map((c) => c.code));
    return roots.map((r) => ({
      ...r,
      children: list.filter((c) => c.parentCode === r.code),
      imageUrl: covers.get(r.code) ?? null,
    }));
  },
};
