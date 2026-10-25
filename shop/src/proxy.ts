import { NextResponse, type NextRequest } from 'next/server';
import { idFromSlug, productPath } from '@/lib/catalog-urls';
import { SEARCH_HEADER } from '@/lib/internal-headers';
import { isReservedSlug } from '@/lib/reserved-slugs';
import { catalogRepository } from '@/server/repositories/catalog.repository';
import { indexingBlocked } from '@/server/seo-policy';

/**
 * 1. Product addresses live at the site root (/<slug>). The old /p/<slug> links — and any non-canonical root form
 *    (/123, /123-نام, an outdated English slug) — get a 301 to the canonical address, so old links and their search
 *    ranking carry over. Reserved top-level segments (/shop, /cart, …: src/lib/reserved-slugs.ts) are never looked
 *    up. Next's permanentRedirect() would send 308; the layout's canonical check stays as the fallback (308) for
 *    when this lookup fails. An unknown /p/… address falls through to a real 404.
 * 2. Layouts cannot read the query string, but the canonical-URL redirect in the /c/[slug] and /[slug] layouts must
 *    keep it (an old link with ?sort=…&page=2 should land on the same filtered view). This passes it along in an
 *    internal request header. Any client-sent value of that header is overwritten.
 * 3. While search engines are kept out (src/server/seo-policy.ts), every response carries X-Robots-Tag: noindex.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const old = /^\/p\/([^/]+)\/?$/.exec(pathname);
  const root = old ? null : /^\/([^/]+)\/?$/.exec(pathname);
  const segment = old?.[1] ?? (root && !isReservedSlug(decoded(root[1] ?? '')) ? root[1] : null);
  if (segment) {
    const target = await canonicalProduct(segment);
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

/** Canonical (percent-encoded) path of the product in `segment`, or null (unknown id, database error). */
const cache = new Map<number, { path: string | null; at: number }>();
async function canonicalProduct(segment: string): Promise<string | null> {
  const id = idFromSlug(segment);
  if (id === null) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.path;
  let path: string | null = null;
  try {
    const p = await catalogRepository.getProductSlug(id);
    path = p ? encodeURI(productPath(id, p.name.replace(/\s+/g, ' ').trim(), p.slug_en)) : null;
  } catch {
    return null; // the page shows the «unavailable» state; never redirect on a guess
  }
  if (cache.size > 5000) cache.clear();
  cache.set(id, { path, at: Date.now() });
  return path;
}

// every page and API route; static assets (hashed files, optimised images, the icon) skip the proxy
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

const decoded = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};
