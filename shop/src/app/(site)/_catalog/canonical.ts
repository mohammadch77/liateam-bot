import 'server-only';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { SEARCH_HEADER } from '@/lib/internal-headers';
import { idFromSlug } from '@/lib/urls';

/**
 * Runs in the segment layout, i.e. BEFORE loading.tsx starts streaming, so search engines get real status codes:
 * 404 for unknown ids and 308 to the canonical /123-name or /english-slug-123 (or /c/…) for a missing or outdated slug.
 * A database error is not a 404: the page itself shows the «unavailable» state.
 */
export async function enforceCanonical(
  slug: string,
  lookup: (id: number) => Promise<{ href: string } | null>,
): Promise<void> {
  const id = idFromSlug(slug);
  if (id === null) notFound();
  let ref: { href: string } | null;
  try {
    ref = await lookup(id);
  } catch {
    return;
  }
  if (!ref) notFound();
  const want = decodeURIComponent(ref.href.split('/').pop() ?? '');
  let got = slug;
  try {
    got = decodeURIComponent(slug);
  } catch {
    /* keep raw */
  }
  if (got !== want) {
    // keep filters/sort/page (passed in by src/proxy.ts); only a well-formed query is carried over
    const search = (await headers()).get(SEARCH_HEADER) ?? '';
    const query = /^\?[^\s#]{0,500}$/.test(search) ? search : '';
    // HTTP headers are ASCII: the Persian words must be percent-encoded in Location.
    permanentRedirect(encodeURI(ref.href) + query);
  }
}
