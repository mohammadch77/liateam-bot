import { NextResponse, type NextRequest } from 'next/server';
import { CATEGORY_BASE, PRODUCT_BASE, categoryPath, idFromSlug, legacyRoute, productPath, type LegacyTarget } from '@/lib/urls';
import { SEARCH_HEADER } from '@/lib/internal-headers';
import { catalogRepository } from '@/server/repositories/catalog.repository';
import { indexingBlocked } from '@/server/seo-policy';

/**
 * 1. Old addresses get ONE permanent redirect (301) to the new one, query string kept — old links and their search
 *    ranking carry over. The map is legacyRoute() in src/lib/urls.ts: /<slug> and /p/<slug> → /shop/product/<slug>,
 *    /c/<slug> → /shop/category/<slug>, /brands/<slug> → /shop/brand/<slug>, /brands, /categories, /offers, /search
 *    and /packs/… → the same under /shop. A product or category is resolved to its canonical address right here, so
 *    there is no second hop (the layouts' canonical check, 308, stays as the fallback). An unknown product or
 *    category falls through to a real 404; if the database fails the segment is passed on as it is.
 * 2. Layouts cannot read the query string, but the canonical-URL redirect in the /shop/category/[slug] and
 *    /shop/product/[slug] layouts must keep it (a link with ?sort=…&page=2 should land on the same filtered view).
 *    This passes it along in an internal request header. Any client-sent value of that header is overwritten.
 * 3. While search engines are kept out (src/server/seo-policy.ts), every response carries X-Robots-Tag: noindex.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // an old address, or a new product/category address spelled in a non-canonical way (/shop/product/541, a Persian or
  // outdated slug): both get the one 301 straight to the canonical address
  const spelled = /^\/shop\/(product|category)\/([^/]+)\/?$/.exec(pathname);
  const old = legacyRoute(pathname) ?? (spelled ? ({ kind: spelled[1], segment: spelled[2] } as LegacyTarget) : null);
  if (old) {
    const target = await legacyTarget(old);
    if (target && decoded(target) !== decoded(pathname)) {
      const query = /^\?[^\s#]{0,500}$/.test(search) ? search : '';
      return NextResponse.redirect(new URL(target + query, request.url), 301);
    }
  }
  const headers = new Headers(request.headers);
  headers.set(SEARCH_HEADER, search);
  const response = NextResponse.next({ request: { headers } });
  // search engines kept out (outside production always; in production the admin's switch): on every response
  if (await indexingBlocked()) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

async function legacyTarget(t: NonNullable<ReturnType<typeof legacyRoute>>): Promise<string | null> {
  if (t.kind === 'path') return encodeURI(t.path);
  const id = idFromSlug(t.segment);
  if (id === null) return null;
  const canonical = t.kind === 'product' ? await canonicalProduct(id) : await canonicalCategory(id);
  if (canonical.state === 'unknown') return null;
  // database error: send the segment on as it is (the page's own check decides)
  return canonical.state === 'ok'
    ? canonical.path
    : `${t.kind === 'product' ? PRODUCT_BASE : CATEGORY_BASE}/${t.segment}`;
}

type Canonical = { state: 'ok'; path: string } | { state: 'unknown' } | { state: 'error' };
const cache = new Map<string, { value: Canonical; at: number }>();
const remember = async (key: string, load: () => Promise<string | null>): Promise<Canonical> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value: Canonical;
  try {
    const path = await load();
    value = path ? { state: 'ok', path: encodeURI(path) } : { state: 'unknown' };
  } catch {
    return { state: 'error' }; // never redirect on a guess, never cache a failure
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, { value, at: Date.now() });
  return value;
};
const clean = (name: string) => name.replace(/\s+/g, ' ').trim();
const canonicalProduct = (id: number) =>
  remember(`p${id}`, async () => {
    const p = await catalogRepository.getProductSlug(id);
    return p ? productPath(id, clean(p.name), p.slug_en) : null;
  });
const canonicalCategory = (code: number) =>
  remember(`c${code}`, async () => {
    const c = await catalogRepository.getCategory(code);
    return c ? categoryPath(c.code, clean(c.name)) : null;
  });

// every page and API route; static assets (hashed files, optimised images, the icon) skip the proxy
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

const decoded = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};
