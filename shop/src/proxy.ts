import { NextResponse, type NextRequest } from 'next/server';
import { idFromSlug, productPath } from '@/lib/catalog-urls';
import { SEARCH_HEADER } from '@/lib/internal-headers';
import { catalogRepository } from '@/server/repositories/catalog.repository';

/**
 * 1. Product addresses: any non-canonical form of /p/… (the old Persian /p/123-نام links, /p/123, an outdated
 *    English slug) gets a 301 to the canonical English slug, so old links and their search ranking carry over.
 *    Next's permanentRedirect() would send 308; the layout's canonical check stays as the fallback (308) for
 *    when this lookup fails.
 * 2. Layouts cannot read the query string, but the canonical-URL redirect in /c/[slug] and /p/[slug] layouts must
 *    keep it (an old link with ?sort=…&page=2 should land on the same filtered view). This passes it along in an
 *    internal request header. Any client-sent value of that header is overwritten.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const m = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    const target = await canonicalProduct(m[1] ?? '');
    if (target && decoded(target) !== decoded(pathname)) {
      const query = /^\?[^\s#]{0,500}$/.test(search) ? search : '';
      return NextResponse.redirect(new URL(target + query, request.url), 301);
    }
  }
  const headers = new Headers(request.headers);
  headers.set(SEARCH_HEADER, search);
  return NextResponse.next({ request: { headers } });
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

export const config = { matcher: ['/c/:path*', '/p/:path*'] };

const decoded = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};
