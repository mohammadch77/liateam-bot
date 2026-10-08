// Cheap "has anything changed?" fingerprint for live refresh: one row of max ids / timestamps.
import { cookies } from 'next/headers';
import { q } from '@/lib/db';
import { COOKIE, verifySession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifySession((await cookies()).get(COOKIE)?.value))) return new Response('Unauthorized', { status: 401 });
  try {
    const [r] = await q(`SELECT concat_ws('|',
        (SELECT max(id) FROM sync_runs), (SELECT max(id) FROM product_events), (SELECT max(id) FROM settings_audit),
        (SELECT max(updated_at) FROM settings), (SELECT max(updated_at) FROM supplier_products),
        (SELECT count(*) FROM run_requests WHERE picked_at IS NULL),
        (SELECT max(updated_at) FROM bot_status WHERE key <> 'worker'),
        (SELECT count(*) || ':' || COALESCE(max(last_seen_at)::text, '') FROM messenger_chats)) AS v`);
    return Response.json({ v: r.v }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ v: 'db-down' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
