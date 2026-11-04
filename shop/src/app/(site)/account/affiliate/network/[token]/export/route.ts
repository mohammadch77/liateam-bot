import { logger } from '@/lib/logger';
import { buildXlsx, XLSX_TYPE } from '@/server/export/xlsx';
import { getCurrentUser } from '@/server/services/session.service';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';

export const dynamic = 'force-dynamic';

/**
 * Excel file of ONE referred person's orders. The affiliate comes from the session; the person comes from an opaque token that only
 * this affiliate was given, and the database must say this affiliate referred them. Anything else is the same plain 404.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAffiliateUser(user)) return new Response('not found', { status: 404 });
  const { token } = await ctx.params;
  try {
    const table = await affiliatePanelService.personExport(user, token);
    return new Response(Buffer.from(buildXlsx(table)), {
      headers: {
        'content-type': XLSX_TYPE,
        'content-disposition': 'attachment; filename="referred-orders.xlsx"',
        'cache-control': 'private, no-store',
      },
    });
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? (e as { code?: string }).code : undefined;
    if (code === 'NOT_FOUND') return new Response('not found', { status: 404 });
    if (code === 'RATE_LIMITED') return new Response('too many requests', { status: 429 });
    logger.error('affiliate.person_export_failed', { err: e instanceof Error ? e.message : 'unknown' });
    return new Response('error', { status: 500 });
  }
}
