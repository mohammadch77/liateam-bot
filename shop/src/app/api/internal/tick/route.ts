import { headers } from 'next/headers';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { tickAllowed } from '@/lib/orders/tick';
import { orderTickService } from '@/server/services/order-tick.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/tick — the background worker: moves paid orders on without anyone opening their page. Called every minute by
 * scripts/tick.mjs (a systemd timer) on the same machine. It exists only with CRON_SECRET configured and answers ONLY a request that
 * carries it in `x-cron-secret` AND comes from the machine itself (nginx puts the visitor's address in X-Real-IP, the script sends none);
 * anything else gets 404, not 401, so the endpoint does not reveal itself. Works the same on production.
 */
export async function POST() {
  const h = await headers();
  if (!tickAllowed(getConfig().CRON_SECRET, h)) return new Response('not found', { status: 404 });
  try {
    const report = await orderTickService.advancePendingOrders();
    return Response.json({ ok: true, ...report });
  } catch (e) {
    logger.error('order_tick.route_failed', { err: e instanceof Error ? e.message : 'unknown' });
    return Response.json({ ok: false }, { status: 500 });
  }
}
