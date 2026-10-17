import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { requestMeta } from '@/server/http/request';
import { catalogService, SUGGEST_LIMITS } from '@/server/services/catalog.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/suggest?q=… — search-as-you-type for the header's search box (the one place the storefront
 * fetches from the browser). Public, read-only, input validated and bounded; per-IP rate limited when the IP is
 * known (behind nginx). Returns only the Suggestions shape: name, brand, price, picture and link — never cost.
 */
const schema = z.object({
  q: z.string().trim().min(SUGGEST_LIMITS.minLength).max(SUGGEST_LIMITS.maxLength),
});

/** Sliding one-minute window per IP: typing with a 200 ms debounce stays far below it. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const hits = new Map<string, number[]>();
function limited(ip: string | null): boolean {
  if (!ip) return false;
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (now - (v.at(-1) ?? 0) >= WINDOW_MS) hits.delete(k);
  return recent.length > MAX_PER_WINDOW;
}

export async function GET(request: Request) {
  try {
    const { ip } = await requestMeta();
    if (limited(ip)) throw new AppError('RATE_LIMITED');
    const parsed = schema.safeParse({ q: new URL(request.url).searchParams.get('q') ?? '' });
    if (!parsed.success) throw new AppError('INVALID_DATA');
    const data = await catalogService.suggest(parsed.data.q);
    return Response.json(data, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (e) {
    const err = toAppError(e);
    return Response.json(err.toJSON(), { status: err.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
