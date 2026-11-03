import { commissionsCsv } from '@/lib/affiliate/report';
import { logger } from '@/lib/logger';
import { getCurrentUser } from '@/server/services/session.service';
import { affiliatePanelService, commissionFilterOf, isAffiliateUser } from '@/server/services/affiliate-panel.service';

export const dynamic = 'force-dynamic';

/**
 * The CSV of the signed-in affiliate's own commissions (the page's filters, up to 5000 rows). The user comes from the session only: there
 * is no id in the address, so nobody can ask for another affiliate's data. Anyone else, signed in or not, gets a plain 404.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAffiliateUser(user)) return new Response('not found', { status: 404 });
  try {
    const sp = Object.fromEntries(new URL(request.url).searchParams) as Record<string, string>;
    const rows = await affiliatePanelService.exportRows(user, commissionFilterOf(sp));
    return new Response(commissionsCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="commissions.csv"',
        'cache-control': 'private, no-store',
      },
    });
  } catch (e) {
    const limited = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'RATE_LIMITED';
    if (!limited) logger.error('affiliate.export_failed', { err: e instanceof Error ? e.message : 'unknown' });
    return new Response(limited ? 'too many requests' : 'error', { status: limited ? 429 : 500 });
  }
}
