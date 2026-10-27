import { isReservedSlug } from './reserved-slugs.ts';

/**
 * Every internal address of the shop is built here — no page, component or service writes a path by hand.
 *
 *   /shop                               the whole catalog (filters, sort and ?page=N are query parameters)
 *   /shop/category/<code>-<words>       a category (the supplier code first; the words are for people and search engines)
 *   /shop/product/<slug>                a product: the English slug the sync bot assigns (ends with the code), or
 *                                       <code>-<Persian words> until it has one
 *   /shop/brand/<slug>                  a brand (the Latin slug the sync bot assigns)
 *   /shop/brands, /shop/categories, /shop/offers, /shop/search, /shop/packs/<collection>/<variant>
 *
 * The old addresses (/<slug>, /p/<slug>, /c/<slug>, /brands/…, /categories, /offers, /search, /packs/…) are
 * redirected permanently by src/proxy.ts using legacyRoute() below. Only the number in a product or category
 * segment is read; any other spelling of it is redirected to the canonical one.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[‌‏‎]/g, '-') // ZWNJ and direction marks
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
}

const withSlug = (base: string, id: number, name: string | null) => {
  const slug = name ? slugify(name) : '';
  return `${base}/${id}${slug ? `-${slug}` : ''}`;
};

const ENGLISH_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SHOP = '/shop';
export const PRODUCT_BASE = '/shop/product';
export const CATEGORY_BASE = '/shop/category';
export const BRAND_BASE = '/shop/brand';

export const shopPath = () => SHOP;
export const categoriesPath = () => '/shop/categories';
export const brandsPath = () => '/shop/brands';
export const offersPath = () => '/shop/offers';
export const searchPath = () => '/shop/search';
export const brandPath = (slug: string) => `${BRAND_BASE}/${slug}`;
export const packPath = (collection: string, key: string) => `/shop/packs/${collection}/${key}`;
export const categoryPath = (code: number, name: string | null) => withSlug(CATEGORY_BASE, code, name);

/** A product's address: /shop/product/<slug_en> when the bot has assigned one (it always ends with "-<id>"), else /shop/product/<id>-<Persian words>. */
export const productPath = (id: number, name: string | null, slugEn?: string | null) =>
  slugEn && ENGLISH_SLUG.test(slugEn) && slugEn.endsWith(`-${id}`)
    ? `${PRODUCT_BASE}/${slugEn}`
    : withSlug(PRODUCT_BASE, id, name);

/** `path` + a query string made of the given parameters (empty values are left out). */
export function withQuery(path: string, params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (v === undefined || v === null || v === '' ? [] : [[k, String(v)]])),
  ).toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * The supplier code in a URL segment, or null: 'serge-rimel-541' (English slug, code last), '1234-سرم-…'
 * (Persian, raw or percent-encoded, code first) or '1234'. An all-ASCII segment is an English slug.
 */
export function idFromSlug(param: string): number | null {
  let s = param;
  try {
    s = decodeURIComponent(param);
  } catch {
    /* already decoded */
  }
  if (ENGLISH_SLUG.test(s) && !/^\d{1,9}$/.test(s)) {
    const tail = /-(\d{1,9})$/.exec(s);
    return tail ? Number(tail[1]) : null;
  }
  const m = /^(\d{1,9})(?:-|$)/.exec(s);
  return m ? Number(m[1]) : null;
}

/** Where an old address goes: straight to a new path, or to the canonical address of the product / category in `segment`. */
export type LegacyTarget =
  | { kind: 'path'; path: string }
  | { kind: 'product'; segment: string }
  | { kind: 'category'; segment: string };

const decoded = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const MOVED_PAGES: Record<string, string> = {
  '/brands': '/shop/brands',
  '/categories': '/shop/categories',
  '/offers': '/shop/offers',
  '/search': '/shop/search',
};

/**
 * The old-address → new-address map (pure; the query string is carried over by the caller). null = not an old address.
 * One hop always: a product or category target is resolved to its canonical path by the caller before redirecting.
 */
export function legacyRoute(pathname: string): LegacyTarget | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const moved = MOVED_PAGES[p];
  if (moved) return { kind: 'path', path: moved };
  let m = /^\/p\/([^/]+)$/.exec(p);
  if (m) return { kind: 'product', segment: m[1]! };
  m = /^\/c\/([^/]+)$/.exec(p);
  if (m) return { kind: 'category', segment: m[1]! };
  m = /^\/brands\/([^/]+)$/.exec(p);
  if (m) return { kind: 'path', path: brandPath(m[1]!) };
  m = /^\/packs\/([^/]+)\/([^/]+)$/.exec(p);
  if (m) return { kind: 'path', path: packPath(m[1]!, m[2]!) };
  // a product at the site root: /<slug> — unless the segment is one of the shop's own pages
  m = /^\/([^/]+)$/.exec(p);
  if (m && !isReservedSlug(decoded(m[1]!))) return { kind: 'product', segment: m[1]! };
  return null;
}

/**
 * The sync bot names pages by its own (old) addresses — /p/<slug>, /<slug>, /c/<slug>, /brands/…, '/p/[slug]' and the
 * like. This turns one into the address the shop serves now (an address already new, or not a shop page, is returned
 * unchanged), so the bot needs no change.
 */
export function shopAddressOf(botPath: string): string {
  const t = legacyRoute(botPath);
  if (!t) return botPath;
  if (t.kind === 'path') return t.path;
  return `${t.kind === 'product' ? PRODUCT_BASE : CATEGORY_BASE}/${t.segment}`;
}

/**
 * <link rel=canonical> and robots of a listing page. ?page=N is its own indexable page (self-canonical, N ≥ 2); any
 * filter or sort parameter makes the view a duplicate: noindex (links still followed) and canonical = the base page.
 */
export function listingSeo(
  basePath: string,
  query: Record<string, string | string[] | undefined>,
): { canonical: string; robots?: { index: false; follow: true } } {
  const filtered = Object.entries(query).some(
    ([k, v]) => k !== 'page' && (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== ''),
  );
  const raw = query.page;
  const page = Number(Array.isArray(raw) ? raw[0] : raw);
  const canonical = !filtered && Number.isInteger(page) && page > 1 ? `${basePath}?page=${page}` : basePath;
  return filtered ? { canonical, robots: { index: false, follow: true } } : { canonical };
}
