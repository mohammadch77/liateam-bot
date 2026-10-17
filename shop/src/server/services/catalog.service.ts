import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import { categoryPath, productPath } from '@/lib/catalog-urls';
import {
  catalogRepository,
  type CategoryRow,
  type ProductRow,
  type ProductSort,
} from '@/server/repositories/catalog.repository';
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

/** Same normalisation as the database side (Arabic ي/ك, ZWNJ, case), then words. */
export function searchWords(q: string | undefined): string[] {
  if (!q) return [];
  return q
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 1)
    .slice(0, 6);
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
    href: productPath(r.id, clean(r.name)),
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
  const words = searchWords(params.q);
  const categories = extra.categories ?? (params.cat ? [params.cat] : undefined);
  const [{ names }, { rows, total }] = await Promise.all([
    categoryNames(),
    catalogRepository.listProducts({
      categories,
      words,
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
    return {
      product,
      description: descriptionBlocks(row.description),
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
    return p ? { href: productPath(p.id, clean(p.name)) } : null;
  }),

  async allCategories(): Promise<Category[]> {
    return (await categoryNames()).list;
  },
};
