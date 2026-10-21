import { z } from 'zod';
import { NAV_LIMITS } from '@/lib/bestsellers';
import { AppError, toAppError } from '@/lib/errors';
import { requestMeta } from '@/server/http/request';
import { navProducts } from '@/server/services/bestseller.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nav/products?cat=155&limit=6 | ?brand=7&limit=4 — a header menu pane's products, loaded on hover (never
 * in a page's HTML). Public and read-only: input validated, limit capped, per-IP rate limited (behind nginx), the
 * result cached server-side (dropped on a price / stock / panel change) and for a minute in the browser. Only public
 * fields: name, link, picture, price (and the price before a discount), in stock.
 */
const schema = z
  .object({
    cat: z.coerce.number().int().positive().max(1_000_000).optional(),
    brand: z.coerce.number().int().positive().max(1_000_000).optional(),
    limit: z.coerce.number().int().min(1).max(NAV_LIMITS.wide).default(NAV_LIMITS.wide),
  })
  .refine((q) => (q.cat === undefined) !== (q.brand === undefined), 'exactly one of cat / brand');

/** Hovering through a menu: a few requests a second at most; the window is generous for that. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 240;
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
    const sp = new URL(request.url).searchParams;
    const parsed = schema.safeParse({
      cat: sp.get('cat') ?? undefined,
      brand: sp.get('brand') ?? undefined,
      limit: sp.get('limit') ?? undefined,
    });
    if (!parsed.success) throw new AppError('INVALID_DATA');
    const q = parsed.data;
    const data = await navProducts(
      q.cat !== undefined ? { category: q.cat, limit: q.limit } : { brand: q.brand!, limit: q.limit },
    );
    if (!data) throw new AppError('NOT_FOUND');
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (e) {
    const err = toAppError(e);
    return Response.json(err.toJSON(), { status: err.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
