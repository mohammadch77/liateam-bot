import 'server-only';
import { pool, q } from './db';

/**
 * Hands work to the orders service (src/orders.mjs) and waits for its answer. The dashboard never
 * talks to Liateam itself; it only inserts into order_jobs (the service is woken by NOTIFY).
 * @returns {{ ok: boolean, id: number, result: any }}  ok=false with result.error on a refused job
 */
export async function runJob(kind, payload, requestedBy, timeoutMs = 30_000) {
  const [{ id }] = await q('INSERT INTO order_jobs (kind, payload, requested_by) VALUES ($1, $2::jsonb, $3) RETURNING id',
    [kind, JSON.stringify(payload ?? {}), requestedBy]);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { rows: [job] } = await pool.query('SELECT done_at, ok, result FROM order_jobs WHERE id = $1', [id]);
    if (job?.done_at) return { ok: job.ok === true, id, result: job.result };
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: false, id, result: { error: 'سرویس سفارش‌ها پاسخ نداد (liateam-orders روشن است؟)' } };
}

/** Same job, answered as a JSON API response (for app/api/test/*). */
export async function jobResponse(kind, payload, requestedBy, timeoutMs) {
  const r = await runJob(kind, payload, requestedBy, timeoutMs);
  return Response.json({ ok: r.ok, job_id: r.id, ...(r.ok ? { data: r.result } : { error: r.result?.error ?? 'خطا' }) },
    { status: r.ok ? 200 : r.result?.kind === 'InputError' ? 400 : 502 });
}
