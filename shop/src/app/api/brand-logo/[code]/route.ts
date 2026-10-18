import { logger } from '@/lib/logger';
import { catalogRepository } from '@/server/repositories/catalog.repository';

/**
 * GET /api/brand-logo/<code> — a brand's logo, fetched once by the server from Liateam's image host and cached, so
 * visitors never load it from the supplier (same rule as /_next/image, which does not optimise SVG). The SVG is
 * served with a CSP that forbids scripts, and only as an image.
 */
const ALLOWED = /^https:\/\/s3\.liateam\.ir\/[\w/.%-]+\.(svg|png|jpe?g|webp)$/i;
const TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const MAX_BYTES = 512 * 1024;
const cacheByUrl = new Map<string, { body: ArrayBuffer; type: string; at: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

const notFound = () => new Response('not found', { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = Number((await ctx.params).code);
  if (!Number.isInteger(code) || code <= 0 || code > 1e6) return notFound();
  const url = await catalogRepository.brandLogo(code).catch(() => null);
  const ext = url ? ALLOWED.exec(url)?.[1]?.toLowerCase() : undefined;
  const type = ext ? TYPES[ext] : undefined;
  if (!url || !type) return notFound();

  let hit = cacheByUrl.get(url);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const body = await res.arrayBuffer();
      if (!res.ok || body.byteLength > MAX_BYTES)
        throw new Error(`HTTP ${res.status}, ${body.byteLength} bytes`);
      hit = { body, type, at: Date.now() };
      cacheByUrl.set(url, hit);
    } catch (e) {
      logger.warn('brand_logo.fetch_failed', { code, err: e });
    }
  }
  if (!hit) return new Response('unavailable', { status: 502 });
  return new Response(hit.body, {
    headers: {
      'Content-Type': hit.type,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
