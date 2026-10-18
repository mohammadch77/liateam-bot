import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import { categoryPath, productPath } from '@/lib/catalog-urls';
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
import type { ProductCardData, StockState } from '@/ui';

/** Catalog display policy. */
export const CATALOG_POLICY = {
  pageSize: 20, // 2 / 4 / 5 columns → full rows on phone, laptop and desktop
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

/** The stored description (plain text from the sync bot) as typed blocks: never rendered as HTML. */
export type DescriptionBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] };

/** "## " heading, "• " list item, blank line between blocks (format written by the bot's product-details.mjs). */
export function descriptionBlocks(text: string | null): DescriptionBlock[] {
  if (!text) return [];
  const blocks: DescriptionBlock[] = [];
  for (const chunk of text.split(/\n{2,}/)) {
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
};

const VIDEO_PLAYER =
  /^https:\/\/player\.arvancloud\.ir\/index\.html\?config=https:\/\/[a-z0-9-]+\.arvanvod\.ir\/[\w/.-]+\.json$/i;
const IMAGE_HOST = /^https:\/\/s3\.liateam\.ir\//;
const textLines = (s: string | null) =>
  (s ?? '')
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
      body: r.body,
      reply: r.reply,
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
    features: row.features.filter((f) => !summary.includes(f.trim())),
    videoEmbedUrl: row.video_embed_url && VIDEO_PLAYER.test(row.video_embed_url) ? row.video_embed_url : null,
    recommendPercent: row.rating_value,
    attributes: c.attributes,
    howToUse: textLines(row.how_to_use),
    faqs: c.faqs,
    reviews: reviews.slice(0, PRODUCT_REVIEWS_SHOWN),
    reviewsTotal: (row.reviews_total ?? c.reviews.length) + site.length,
  };
}

export type Listing = {
  items: ProductView[];
  total: number;
  page: number;
  totalPages: number;
  params: ListParams;
};

// ── query-string parsing (URL input is untrusted) ──
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const listParamsSchema = z.object({
  page: z.preprocess(one, z.coerce.number().int().min(1).max(CATALOG_POLICY.maxPage).catch(1)).default(1),
  sort: z
    .preprocess(one, z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).catch('relevance'))
    .default('relevance'),
  inStock: z.preprocess(one, z.enum(['1']).optional().catch(undefined)),
  cat: z.preprocess(one, z.coerce.number().int().positive().optional().catch(undefined)),
  q: z.preprocess(one, z.string().trim().max(CATALOG_POLICY.maxQueryLength).optional().catch(undefined)),
});
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

function toView(r: ProductRow, names: Map<number, string>): ProductView {
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
    priceToman: r.price,
    oldPriceToman: null, // the supplier feed has no list price, so no discount is ever shown
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

async function listing(params: ListParams, extra: { categories?: number[] } = {}): Promise<Listing> {
  const search = (await searchTerms(params.q)) ?? undefined;
  const categories = extra.categories ?? (params.cat ? [params.cat] : undefined);
  const [{ names }, { rows, total }] = await Promise.all([
    categoryNames(),
    catalogRepository.listProducts({
      categories,
      search,
      inStockOnly: params.inStock === '1',
      sort: params.sort,
      limit: CATALOG_POLICY.pageSize,
      offset: (params.page - 1) * CATALOG_POLICY.pageSize,
    }),
  ]);
  return {
    items: rows.map((r) => toView(r, names)),
    total,
    page: params.page,
    totalPages: Math.max(1, Math.ceil(total / CATALOG_POLICY.pageSize)),
    params,
  };
}

export const catalogService = {
  async home() {
    const [{ list }, newest, inStock] = await Promise.all([
      categoryNames(),
      catalogRepository.listProducts({ sort: 'newest', limit: 10, offset: 0, inStockOnly: true }),
      catalogRepository.listProducts({ sort: 'price_desc', limit: 10, offset: 0, inStockOnly: true }),
    ]);
    const names = new Map(list.map((c) => [c.code, c.name]));
    const topCategories = list.filter((c) => c.parentCode === null || !names.has(c.parentCode)).slice(0, 8);
    const covers = await catalogRepository.categoryCovers(topCategories.map((c) => c.code));
    return {
      categories: topCategories.map((c) => ({ ...c, imageUrl: covers.get(c.code) ?? null })),
      newest: newest.rows.map((r) => toView(r, names)),
      featured: inStock.rows.map((r) => toView(r, names)),
      featuredHero: inStock.rows.find((r) => r.image_url) ?? null,
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
    const result = await listing({ ...params, cat: sub }, { categories: [sub ?? code] });
    const parent = category.parent_code ? (list.find((c) => c.code === category.parent_code) ?? null) : null;
    return { category: toCategory(category), parent, children, listing: result };
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
    const { list, names } = await categoryNames();
    const product = toView(row, names);
    // breadcrumb: root → … → the product's main category (guarded against a cyclic tree)
    const byCode = new Map(list.map((c) => [c.code, c]));
    const trail: Category[] = [];
    for (let c = byCode.get(product.categories[0]?.code ?? -1); c && trail.length < 6;) {
      trail.unshift(c);
      c = c.parentCode !== null ? byCode.get(c.parentCode) : undefined;
    }
    const related = product.categories[0]
      ? await catalogRepository.listProducts({
          categories: [product.categories[0].code],
          excludeId: id,
          inStockOnly: true,
          sort: 'relevance',
          limit: 5,
          offset: 0,
        })
      : { rows: [] };
    const [content, siteReviews] = await Promise.all([
      catalogRepository.getProductContent(id),
      reviewRepository.approvedFor(id, PRODUCT_REVIEWS_SHOWN),
    ]);
    return {
      product,
      description: descriptionBlocks(row.description),
      content: toContent(row, content, siteReviews),
      trail,
      related: related.rows.map((r) => toView(r, names)),
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
    const [{ list, names }, { rows, total }] = await Promise.all([
      categoryNames(),
      catalogRepository.listProducts({
        search: terms,
        sort: 'relevance',
        limit: SUGGEST_LIMITS.products,
        offset: 0,
      }),
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
        const v = toView(r, names);
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
