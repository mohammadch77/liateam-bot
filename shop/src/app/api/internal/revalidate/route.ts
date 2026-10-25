import { timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { dataChanged } from '@/server/cache-events';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/revalidate — the sync bot, after it committed a change, asks the shop to drop the cached
 * pages that show it: { paths: [{ path: '/serge-…-541' }, { path: '/c/[slug]', type: 'page' }, …] }.
 * Only with the shared secret (header x-revalidate-secret = REVALIDATE_SECRET); off (404) without one configured.
 * Storefront pages are rendered per request today, so this mostly clears the router/full-route cache; it keeps
 * changes visible at once if data caching is added later.
 */
const ROUTE_PATTERNS = new Set(['/[slug]', '/c/[slug]', '/brands/[slug]']);
/**
 * Products moved from /p/<slug> to /<slug>; the bot still names them the old way (/p/<slug>, '/p/[slug]'), so its
 * paths are translated here and the bot needs no change.
 */
const productAddress = (path: string) =>
  path === '/p/[slug]' ? '/[slug]' : path.startsWith('/p/') ? path.slice(2) : path;
const schema = z.object({
  paths: z
    .array(
      z.object({
        // a concrete path of the shop (/, /shop, /<product>, old /p/<product>), or one of the route patterns with type 'page'
        path: z
          .string()
          .max(300)
          .regex(/^\/[^\s?#]*$/),
        type: z.enum(['page', 'layout']).optional(),
      }),
    )
    .min(1)
    .max(200),
});

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function POST(req: Request) {
  const secret = getConfig().REVALIDATE_SECRET;
  if (!secret) return new Response('not found', { status: 404 });
  if (!sameSecret(req.headers.get('x-revalidate-secret') ?? '', secret)) {
    logger.warn('revalidate.refused', { reason: 'secret' });
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: 'invalid body' }, { status: 400 });

  const done: string[] = [];
  for (const { path: given, type } of parsed.data.paths) {
    const path = productAddress(given);
    if (path.includes('[') && !(ROUTE_PATTERNS.has(path) && type)) continue; // only known patterns, with a type
    revalidatePath(path, type);
    done.push(type ? `${path} (${type})` : path);
  }
  // the shop's own short caches (prices, packs, best sellers) too
  dataChanged();
  logger.info('revalidate.done', { count: done.length });
  return Response.json({ ok: true, revalidated: done });
}
