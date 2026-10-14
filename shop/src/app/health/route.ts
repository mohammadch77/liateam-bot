import { healthService } from '@/server/services/health.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await healthService.check();
  return Response.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
