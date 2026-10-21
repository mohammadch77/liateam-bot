import { isTabKey } from '@/lib/bestsellers';
import { toAppError } from '@/lib/errors';
import { bestsellerService } from '@/server/services/bestseller.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bestsellers?tab=skin — one home «پرفروش‌ترین‌ها» tab as card data (the section loads a tab when it is
 * first opened). An explicit, minimal shape: nothing else from the catalog (and never a purchase price) leaves here.
 */
export async function GET(req: Request) {
  const tab = new URL(req.url).searchParams.get('tab');
  if (!isTabKey(tab)) return Response.json({ error: 'unknown tab' }, { status: 400 });
  try {
    const items = await bestsellerService.tab(tab);
    return Response.json(
      {
        items: items.map((p) => ({
          id: p.id,
          href: p.href,
          name: p.name,
          brand: p.brand ?? null,
          imageUrl: p.imageUrl ?? null,
          priceToman: p.priceToman,
          oldPriceToman: p.oldPriceToman ?? null,
          stock: p.stock,
        })),
      },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  } catch (e) {
    const err = toAppError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
