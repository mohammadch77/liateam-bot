import 'server-only';
import { query, queryOne } from '@/lib/db';

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

/** Persian-insensitive text: Arabic ي/ك → ی/ک, ZWNJ → space (must match normalizeSearch). */
const NORMALIZED_NAME = `translate(lower(p.name), 'يك' || chr(8204), 'یک ')`;

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
  /** every word must appear in the name (already normalised) */
  words?: readonly string[];
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

/** Escapes LIKE wildcards in user text. */
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
    for (const w of q.words ?? []) where.push(`${NORMALIZED_NAME} LIKE ${add(`%${likeEscape(w)}%`)}`);

    const rows = await query<ProductRow & { total: number }>(
      'catalog.list_products',
      `SELECT ${PRODUCT_COLS}, count(*) OVER ()::int AS total
         FROM product_catalog p
        WHERE ${where.join(' AND ')}
        ORDER BY ${ORDER[q.sort]}
        LIMIT ${add(q.limit)} OFFSET ${add(q.offset)}`,
      params,
    );
    return { rows, total: rows[0]?.total ?? 0 };
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
