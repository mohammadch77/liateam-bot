import 'server-only';
import { query, queryOne } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Read-only access to the supplier catalog kept up to date by the sync bot (public.product_catalog view,
 * public.categories). Columns are listed explicitly: the shop role cannot read cost_price, and never asks.
 */

/** The single rule for what the shop shows: sellable, a real price, and still listed by the supplier. */
const VISIBLE = `p.is_sellable AND p.price > 0 AND p.missing_since IS NULL`;

const PRODUCT_COLS = `p.id, p.name, p.price, p.stock, p.category, p.category_names, p.image_url,
  p.first_seen_at, p.updated_at, p.brand, p.slug_en`;

/**
 * The supplier attaches products to leaf categories only («سرم تخصصی صورت», not «سرم تخصصی»). A category
 * therefore means itself plus all its descendants: `${'$'}n` (int[]) → every code in those subtrees.
 * UNION (not UNION ALL) also guards against a cycle in the supplier's tree.
 */
const subtreeOf = (param: string) =>
  `ARRAY(WITH RECURSIVE t(code) AS (
          SELECT unnest(${param}::int[])
          UNION SELECT c.code FROM categories c JOIN t ON c.parent_code = t.code)
        SELECT code FROM t)`;

/** Fallback (search functions not installed yet): Arabic ي/ك → ی/ک, ZWNJ → space, on the name only. */
const NORMALIZED_NAME = `translate(lower(p.name), 'يك' || chr(8204), 'یک ')`;

/**
 * Searchable text of a product (name + brand, normalised by public.search_norm — the same rules as
 * normalizeSearch in src/lib/search/normalize.ts). A GIN trigram index on exactly this expression
 * (deploy/shop-db-004-search.sql) serves the LIKE '%…%' and `<%` conditions below.
 */
const DOC = `public.search_doc(p.name, p.brand)`;

/**
 * Whether deploy/shop-db-004-search.sql has been run (pg_trgm + search functions). Until then search falls back
 * to plain substring matching on the name; checked again every few minutes, so running the file needs no restart.
 */
let searchReady: { ok: boolean; at: number } | null = null;
async function hasSearchFunctions(): Promise<boolean> {
  if (searchReady && (searchReady.ok || Date.now() - searchReady.at < 5 * 60_000)) return searchReady.ok;
  const row = await queryOne<{ ok: boolean }>(
    'catalog.search_ready',
    `SELECT to_regprocedure('public.search_doc(text,text)') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS ok`,
  );
  const ok = !!row?.ok;
  if (!ok && !searchReady)
    logger.warn('catalog.search_fallback', { reason: 'run deploy/shop-db-004-search.sql' });
  searchReady = { ok, at: Date.now() };
  return ok;
}

/** A query word and the catalog words it may be a misspelling of (the service finds those). */
export type SearchWord = { word: string; alts: readonly string[] };
/** A normalised search: the whole text (for similarity ranking) and its words. */
export type SearchTerms = { text: string; words: readonly SearchWord[] };

/**
 * WHERE conditions and a relevance score for a search. Every word must match the product (name or brand):
 *  - 1–2 letters: the start of a word («ر» → «ریمل», not every name containing «ر»);
 *  - 3+ letters: anywhere (partial: «شامپ» → «شامپو»), or one of its spelling corrections («رمل» → «ریمل»),
 *    or — 4+ letters — trigram word similarity (pg_trgm `<%`, threshold 0.6).
 * Score per word: start of a word 3 › anywhere 2 › a correction 1.5 › trigram similarity (0–1); plus the
 * trigram similarity of the whole query to the name, so closer names rank first.
 */
function searchSql(
  t: SearchTerms,
  add: (v: unknown) => string,
  withScore: boolean,
): { where: string[]; score: string | null } {
  // parameters are bound only when the text that uses them is part of the statement (Postgres must infer
  // the type of every bound parameter, so an unused one is an error)
  const where: string[] = [];
  const scores: string[] = [];
  for (const { word, alts } of t.words) {
    const start = () => `(${DOC} LIKE ${add(`${word}%`)} OR ${DOC} LIKE ${add(`% ${word}%`)})`;
    if (word.length <= 2) {
      where.push(start());
      if (withScore) scores.push('3');
      continue;
    }
    const anywhere = () => `${DOC} LIKE ${add(`%${word}%`)}`;
    const fixed = () =>
      alts.length ? `(${alts.map((a) => `${DOC} LIKE ${add(`%${a}%`)}`).join(' OR ')})` : 'false';
    where.push(`(${anywhere()} OR ${fixed()}${word.length >= 4 ? ` OR ${add(word)} <% ${DOC}` : ''})`);
    if (withScore) {
      scores.push(
        `CASE WHEN ${start()} THEN 3 WHEN ${anywhere()} THEN 2 WHEN ${fixed()} THEN 1.5 ` +
          `ELSE word_similarity(${add(word)}, ${DOC}) END`,
      );
    }
  }
  if (withScore) scores.push(`similarity(${add(t.text)}, public.search_norm(p.name))`);
  return { where, score: withScore ? scores.join(' + ') : null };
}

export type ProductRow = {
  id: number;
  name: string;
  price: number; // TOMAN (Liateam consumer price, as the sync bot stores it)
  stock: number;
  category: number[];
  category_names: string[];
  image_url: string | null;
  first_seen_at: Date;
  updated_at: Date;
  brand: string | null;
  slug_en: string | null;
};

/** Product page only: the long texts are several KB, so lists never select them. */
export type ProductDetailRow = ProductRow & {
  description: string | null;
  summary: string | null;
  features: string[];
  how_to_use: string | null;
  video_embed_url: string | null;
  rating_value: number | null;
  reviews_total: number | null;
  origin_country: string | null;
  /** NUMERIC comes back as a string */
  measurement_value: string | null;
  measurement_unit: 'ml' | 'g' | null;
  color: string | null;
  expire_months: number | null;
  brand_code: number | null;
};

/** The rich sections of one product page (synced by the bot; plain text, no prices). */
export type ProductContentRows = {
  attributes: Array<{ key: string; value: string }>;
  faqs: Array<{ question: string; answer: string }>;
  reviews: Array<{
    author: string | null;
    rating: number | null; // 1-10 (Liateam's scale), null = comment without a score
    body: string;
    reply: string | null;
    created_at: Date | null;
  }>;
  /** extra photos in Liateam's order (the main one is image_url) */
  images: Array<{ url: string; alt: string | null }>;
  /** «مناسب برای»: skin/hair concerns in Liateam's order */
  concerns: string[];
};

export type CategoryRow = {
  code: number;
  name: string;
  parent_code: number | null;
  product_count: number;
};

export type ProductSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';

export type ProductListQuery = {
  /** any of these category codes */
  categories?: readonly number[];
  /** text search (normalised words); with sort 'relevance' the results are ranked by how well they match */
  search?: SearchTerms;
  inStockOnly?: boolean;
  /** only this supplier brand (brands.code) */
  brandCode?: number;
  excludeId?: number;
  /** only these products (the price filter: ids whose final price is in the range) */
  ids?: readonly number[];
  /** ids from the cheapest final price up: the price sorts follow it instead of the list price */
  priceOrder?: readonly number[];
  sort: ProductSort;
  limit: number;
  offset: number;
};

const ORDER: Record<ProductSort, string> = {
  // in-stock first, then newest; id makes every order deterministic for paging
  relevance: '(p.stock > 0) DESC, p.first_seen_at DESC, p.id DESC',
  newest: 'p.first_seen_at DESC, p.id DESC',
  price_asc: 'p.price ASC, p.id ASC',
  price_desc: 'p.price DESC, p.id DESC',
};

/** Escapes LIKE wildcards in user text (normalised words hold letters and digits only; this is defence in depth). */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const catalogRepository = {
  /** One page of products plus the total for pagination (single round trip via a window count). */
  async listProducts(q: ProductListQuery): Promise<{ rows: ProductRow[]; total: number }> {
    const where = [VISIBLE];
    const params: unknown[] = [];
    const add = (v: unknown) => `$${params.push(v)}`;

    if (q.categories?.length) where.push(`p.category && ${subtreeOf(add(q.categories))}`);
    if (q.inStockOnly) where.push('p.stock > 0');
    if (q.brandCode !== undefined) where.push(`p.brand_code = ${add(q.brandCode)}`);
    if (q.excludeId !== undefined) where.push(`p.id <> ${add(q.excludeId)}`);
    // the price filter, worked out on the final prices by the pricing service: only these ids
    if (q.ids) where.push(`p.id = ANY(${add(q.ids)}::int[])`);
    let order = ORDER[q.sort];
    // price sorts on the final price: the ids in that order (cheapest first), then the rest by list price
    if (q.priceOrder && (q.sort === 'price_asc' || q.sort === 'price_desc'))
      order = `array_position(${add(q.priceOrder)}::int[], p.id) ${q.sort === 'price_asc' ? 'ASC' : 'DESC'} NULLS LAST, ${order}`;
    if (q.search?.words.length) {
      if (await hasSearchFunctions()) {
        const { where: w, score } = searchSql(q.search, add, q.sort === 'relevance');
        where.push(...w);
        if (score) order = `${score} DESC, (p.stock > 0) DESC, p.id DESC`;
      } else {
        for (const { word } of q.search.words)
          where.push(`${NORMALIZED_NAME} LIKE ${add(`%${likeEscape(word)}%`)}`);
      }
    }

    const rows = await query<ProductRow & { total: number }>(
      'catalog.list_products',
      `SELECT ${PRODUCT_COLS}, count(*) OVER ()::int AS total
         FROM product_catalog p
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT ${add(q.limit)} OFFSET ${add(q.offset)}`,
      params,
    );
    return { rows, total: rows[0]?.total ?? 0 };
  },

  /**
   * Distinct words (3+ letters) of the visible catalog's names and brands, normalised: the dictionary the
   * service corrects misspelt query words against. Small (a few thousand words); the service caches it.
   */
  async searchVocabulary(): Promise<string[]> {
    if (!(await hasSearchFunctions())) return [];
    const rows = await query<{ w: string }>(
      'catalog.search_vocabulary',
      `SELECT DISTINCT w FROM product_catalog p, regexp_split_to_table(${DOC}, ' ') AS w
        WHERE ${VISIBLE} AND length(w) >= 3`,
    );
    return rows.map((r) => r.w);
  },

  /** id and name of every visible product (admin pickers; a few hundred rows). */
  async productNames(): Promise<Array<{ id: number; name: string }>> {
    return query<{ id: number; name: string }>(
      'catalog.product_names',
      `SELECT p.id, p.name FROM product_catalog p WHERE ${VISIBLE} ORDER BY p.name`,
    );
  },

  /** Visible products by id (any order; the caller orders them). */
  async productsByIds(ids: readonly number[]): Promise<ProductRow[]> {
    if (!ids.length) return [];
    return query<ProductRow>(
      'catalog.products_by_ids',
      `SELECT ${PRODUCT_COLS} FROM product_catalog p WHERE p.id = ANY($1::int[]) AND ${VISIBLE}`,
      [ids],
    );
  },

  async getProduct(id: number): Promise<ProductDetailRow | null> {
    return queryOne<ProductDetailRow>(
      'catalog.get_product',
      `SELECT ${PRODUCT_COLS}, p.description, p.summary, p.features, p.how_to_use, p.video_embed_url,
              p.rating_value, p.reviews_total, p.origin_country, p.measurement_value, p.measurement_unit, p.color,
              p.expire_months, p.brand_code
         FROM product_catalog p WHERE p.id = $1 AND ${VISIBLE}`,
      [id],
    );
  },

  /** Specs, FAQ and synced reviews in Liateam's order (public.product_* tables, read-only). */
  async getProductContent(id: number): Promise<ProductContentRows> {
    const [attributes, faqs, reviews, images, concerns] = await Promise.all([
      query<ProductContentRows['attributes'][number]>(
        'catalog.product_attributes',
        'SELECT key, value FROM public.product_attributes WHERE product_id = $1 ORDER BY position',
        [id],
      ),
      query<ProductContentRows['faqs'][number]>(
        'catalog.product_faqs',
        'SELECT question, answer FROM public.product_faqs WHERE product_id = $1 ORDER BY position',
        [id],
      ),
      query<ProductContentRows['reviews'][number]>(
        'catalog.product_reviews',
        `SELECT author, rating, body, reply, created_at FROM public.product_reviews
          WHERE product_id = $1 ORDER BY position`,
        [id],
      ),
      query<ProductContentRows['images'][number]>(
        'catalog.product_images',
        // photos gone from Liateam's host (ok = false, found by the bot's checks) are left out
        'SELECT url, alt FROM public.product_images WHERE product_id = $1 AND ok IS NOT FALSE ORDER BY position',
        [id],
      ),
      query<{ title: string }>(
        'catalog.product_concerns',
        'SELECT title FROM public.product_concerns WHERE product_id = $1 ORDER BY position',
        [id],
      ),
    ]);
    return { attributes, faqs, reviews, images, concerns: concerns.map((c) => c.title) };
  },

  /** Old address → canonical one: the English slug and name of a visible product (cheap, for the redirect). */
  /** Every visible product's address parts and last change (sitemap). */
  async sitemapProducts(): Promise<
    Array<{ id: number; name: string; slug_en: string | null; updated_at: Date }>
  > {
    return query<{ id: number; name: string; slug_en: string | null; updated_at: Date }>(
      'catalog.sitemap_products',
      `SELECT p.id, p.name, p.slug_en, p.updated_at FROM product_catalog p WHERE ${VISIBLE} ORDER BY p.id`,
    );
  },

  async getProductSlug(id: number): Promise<{ name: string; slug_en: string | null } | null> {
    return queryOne<{ name: string; slug_en: string | null }>(
      'catalog.product_slug',
      `SELECT p.name, p.slug_en FROM product_catalog p WHERE p.id = $1 AND ${VISIBLE}`,
      [id],
    );
  },

  /**
   * The categories the shop shows: Liateam's own tree in Liateam's menu order (position), minus codes Liateam no
   * longer lists and categories with no visible product anywhere in their subtree (e.g. «ابزارها و سمپل ها»).
   */
  async listCategories(): Promise<CategoryRow[]> {
    return query<CategoryRow>(
      'catalog.list_categories',
      `WITH RECURSIVE tree(root, code) AS (
              SELECT code, code FROM categories
              UNION SELECT t.root, c.code FROM tree t JOIN categories c ON c.parent_code = t.code),
            counted AS (
              SELECT t.root, count(DISTINCT p.id)::int AS product_count
                FROM tree t JOIN product_catalog p ON t.code = ANY (p.category) AND ${VISIBLE}
               GROUP BY t.root)
       SELECT c.code, c.name, c.parent_code, n.product_count
         FROM categories c JOIN counted n ON n.root = c.code
        WHERE c.in_source AND c.name IS NOT NULL AND btrim(c.name) <> ''
        ORDER BY c.position NULLS LAST, c.code`,
    );
  },

  async getCategory(code: number): Promise<CategoryRow | null> {
    return queryOne<CategoryRow>(
      'catalog.get_category',
      `SELECT c.code, c.name, c.parent_code,
              (SELECT count(*)::int FROM product_catalog p
                WHERE p.category && ${subtreeOf('ARRAY[$1]')} AND ${VISIBLE}) AS product_count
         FROM categories c
        WHERE c.code = $1 AND c.in_source AND c.name IS NOT NULL`,
      [code],
    );
  },

  /** A picture for each category bubble: the newest in-stock product with an image anywhere in its subtree. */
  async categoryCovers(codes: readonly number[]): Promise<Map<number, string>> {
    if (!codes.length) return new Map();
    const rows = await query<{ code: number; image_url: string }>(
      'catalog.category_covers',
      `WITH RECURSIVE tree(root, code) AS (
              SELECT r, r FROM unnest($1::int[]) AS r
              UNION SELECT t.root, c.code FROM tree t JOIN categories c ON c.parent_code = t.code)
       SELECT DISTINCT ON (t.root) t.root AS code, p.image_url
         FROM tree t
         JOIN product_catalog p ON t.code = ANY (p.category) AND ${VISIBLE}
        WHERE p.image_url IS NOT NULL
        ORDER BY t.root, (p.stock > 0) DESC, p.first_seen_at DESC`,
      [codes],
    );
    return new Map(rows.map((r) => [r.code, r.image_url]));
  },

  /** Visible products of one brand per category (every category, its whole subtree counted), for the filter. */
  async brandCategoryCounts(brandCode: number): Promise<Map<number, number>> {
    const rows = await query<{ code: number; n: number }>(
      'catalog.brand_category_counts',
      `WITH RECURSIVE tree(root, code) AS (
              SELECT code, code FROM categories
              UNION SELECT t.root, c.code FROM tree t JOIN categories c ON c.parent_code = t.code)
       SELECT t.root AS code, count(DISTINCT p.id)::int AS n
         FROM tree t JOIN product_catalog p ON t.code = ANY (p.category) AND ${VISIBLE} AND p.brand_code = $1
        GROUP BY t.root`,
      [brandCode],
    );
    return new Map(rows.map((r) => [r.code, r.n]));
  },

  /** A brand's logo address (Liateam's image host only), for the logo route. */
  async brandLogo(code: number): Promise<string | null> {
    const row = await queryOne<{ image_url: string | null }>(
      'catalog.brand_logo',
      'SELECT image_url FROM brands WHERE code = $1 AND in_source',
      [code],
    );
    return row?.image_url ?? null;
  },

  /**
   * Brands Liateam lists (its order), each with its visible products, its logo and a product photo for its tile
   * (newest in stock). Brands with nothing to sell are left out.
   */
  async listBrands(): Promise<BrandRow[]> {
    return query<BrandRow>(
      'catalog.list_brands',
      `SELECT b.code, b.name, b.latin_name, b.slug, count(p.id)::int AS product_count, b.image_url AS logo_url,
              (array_agg(p.image_url ORDER BY (p.stock > 0) DESC, p.first_seen_at DESC)
                 FILTER (WHERE p.image_url IS NOT NULL))[1] AS image_url,
              (array_agg(p.image_url ORDER BY (p.stock > 0) DESC, p.first_seen_at DESC)
                 FILTER (WHERE p.image_url IS NOT NULL))[1:3] AS image_urls
         FROM brands b
         JOIN product_catalog p ON p.brand_code = b.code AND ${VISIBLE}
        WHERE b.in_source
        GROUP BY b.code
        ORDER BY b.position NULLS LAST, b.code`,
    );
  },

  /**
   * Home-page hero slides the bot mirrors from Liateam (public.hero_slides), in order, each with its destination:
   * a visible product (name, slug_en) or a listed category (name). Slides whose destination is gone are left out.
   */
  async listHeroSlides(): Promise<HeroSlideRow[]> {
    return query<HeroSlideRow>(
      'catalog.hero_slides',
      `SELECT h.position, h.image_url, h.portrait_url, h.color, h.target_type, h.target_code,
              p.name AS product_name, p.slug_en, c.name AS category_name
         FROM hero_slides h
         LEFT JOIN product_catalog p ON h.target_type = 'product' AND p.id = h.target_code AND ${VISIBLE}
         LEFT JOIN categories c ON h.target_type = 'category' AND c.code = h.target_code AND c.in_source
        WHERE p.id IS NOT NULL OR c.code IS NOT NULL
        ORDER BY h.position`,
    );
  },
};

export type BrandRow = {
  code: number;
  name: string;
  latin_name: string | null;
  slug: string;
  product_count: number;
  logo_url: string | null;
  image_url: string | null;
  /** up to three product photos of the brand (in stock first, newest first) */
  image_urls: string[] | null;
};

export type HeroSlideRow = {
  position: number;
  image_url: string;
  portrait_url: string | null;
  color: string | null;
  target_type: 'product' | 'category';
  target_code: number;
  product_name: string | null;
  slug_en: string | null;
  category_name: string | null;
};
