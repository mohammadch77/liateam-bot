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
  p.first_seen_at, p.updated_at, p.brand`;

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
};

/** Product page only: the description can be several KB, so lists never select it. */
export type ProductDetailRow = ProductRow & { description: string | null };

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
  excludeId?: number;
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
    if (q.excludeId !== undefined) where.push(`p.id <> ${add(q.excludeId)}`);
    let order = ORDER[q.sort];
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

  async getProduct(id: number): Promise<ProductDetailRow | null> {
    return queryOne<ProductDetailRow>(
      'catalog.get_product',
      `SELECT ${PRODUCT_COLS}, p.description FROM product_catalog p WHERE p.id = $1 AND ${VISIBLE}`,
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
};
