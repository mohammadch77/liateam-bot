import { logger } from '@/lib/logger';
import { qrPng, qrSvg } from '@/server/export/qr';
import { getCurrentUser } from '@/server/services/session.service';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';

export const dynamic = 'force-dynamic';

/** The signed-in affiliate's referral link as a QR code: ?f=svg (default) or ?f=png, ?download=1 to save it. Only their own link. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAffiliateUser(user)) return new Response('not found', { status: 404 });
  try {
    const sp = new URL(request.url).searchParams;
    const { link, code } = await affiliatePanelService.qrLink(user);
    const png = sp.get('f') === 'png';
    const headers: Record<string, string> = {
      'content-type': png ? 'image/png' : 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, no-store',
    };
    if (sp.get('download') === '1') headers['content-disposition'] = `attachment; filename="referral-${code}.${png ? 'png' : 'svg'}"`;
    return new Response(png ? new Uint8Array(await qrPng(link)) : await qrSvg(link), { headers });
  } catch (e) {
    logger.error('affiliate.qr_failed', { err: e instanceof Error ? e.message : 'unknown' });
    return new Response('error', { status: 500 });
  }
}
