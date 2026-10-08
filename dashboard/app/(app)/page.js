import { q } from '@/lib/db';
import { getHealth } from '@/lib/health';
import { LOW_STOCK } from '@/lib/products';
import { num, pct, ago, duration, countdown, tomanShort, shortDate } from '@/lib/format';
import RunsChart from '../components/RunsChart';
import DbError from '../components/DbError';
import FreshPill from '../components/FreshPill';
import { RunBadge } from '../components/badges';
import { EventRow } from '../components/events';

export const dynamic = 'force-dynamic';

async function load() {
  const t0 = performance.now();
  await q('SELECT 1');
  const dbMs = Math.round(performance.now() - t0);
  const [health, [summary], changes, [today], runs] = await Promise.all([
    getHealth(),
    q(`SELECT count(*)::int AS total,
              count(*) FILTER (WHERE is_sellable)::int AS sellable,
              count(*) FILTER (WHERE NOT is_sellable)::int AS hidden,
              count(*) FILTER (WHERE is_sellable AND stock > 0 AND stock < $1)::int AS low,
              COALESCE(sum(cost_price * stock) FILTER (WHERE is_sellable AND stock > 0), 0) AS stock_value,
              COALESCE(sum(stock) FILTER (WHERE is_sellable AND stock > 0), 0) AS units,
              avg((price - cost_price)::numeric / NULLIF(price, 0)) FILTER (WHERE is_sellable) AS avg_margin,
              count(*) FILTER (WHERE is_sellable AND price > cost_price)::int AS profitable
         FROM supplier_products`, [LOW_STOCK]),
    q('SELECT * FROM product_events ORDER BY id DESC LIMIT 8').catch(() => []),
    q(`SELECT count(*)::int AS n FROM product_events
        WHERE at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran'`).catch(() => [{ n: 0 }]),
    q(`SELECT started_at, status, fetched, sellable, rejected FROM sync_runs ORDER BY started_at DESC LIMIT 20`),
  ]);
  const alerts = health.last && health.last.status !== 'ok'
    ? await q('SELECT message FROM sync_alerts WHERE run_id = $1 ORDER BY id', [health.last.id]) : [];
  return { dbMs, health, summary, changes, today: today.n, runs: runs.reverse(), alerts };
}

export default async function Overview() {
  let d;
  try { d = await load(); } catch (e) { return <DbError error={e} />; }
  const { health: h, summary: s, changes, runs, alerts } = d;
  const session = h.status.session;
  const sessionOk = session?.ok && session?.present;
  const daysLeft = session?.expires_at ? Math.floor((new Date(session.expires_at) - Date.now()) / 86400_000) : null;
  const cd = h.nextRun ? countdown(h.nextRun) : null;

  return (
    <>
      <div className="page-head">
        <div><h1>نمای کلی</h1><div className="sub">وضعیت سلامت ربات و خلاصه‌ی کاتالوگ</div></div>
        <FreshPill health={h} />
      </div>

      <div className="grid g4">
        <div className="card">
          <div className="stat-label">وضعیت آخرین اجرا</div>
          <div className="stat-value">{h.last ? <RunBadge status={h.last.status} big /> : 'هنوز اجرا نشده'}</div>
          <div className="stat-foot">{h.last ? `${ago(h.last.started_at)} · مدت ${duration(h.last.duration_ms)}` : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">اجرای بعدی</div>
          <div className="stat-value">{cd ? `${cd} ساعت دیگر` : h.nextRun ? 'هم‌اکنون' : '—'}</div>
          <div className="stat-foot">زمان‌بندی هر {num(h.intervalH)} ساعت{!h.workerAlive && ' · worker خاموش (تخمینی)'}</div>
        </div>
        <div className="card">
          <div className="stat-label">اعتبار سشن</div>
          <div className="stat-value" style={{ color: sessionOk ? undefined : 'var(--bad)' }}>
            {!session ? 'نامشخص' : !sessionOk ? 'نیاز به لاگین' : daysLeft != null ? `${num(daysLeft)} روز` : 'معتبر'}
          </div>
          <div className="stat-foot">{sessionOk && session.expires_at ? `توکن معتبر تا ${shortDate(session.expires_at)}` : sessionOk ? 'توکن بدون تاریخ انقضا' : 'npm run login روی سرور ربات'}</div>
        </div>
        <div className="card">
          <div className="stat-label">اتصال دیتابیس</div>
          <div className="stat-value" style={{ color: 'var(--ok)' }}>برقرار</div>
          <div className="stat-foot tnum">PostgreSQL · {num(d.dbMs)}ms</div>
        </div>
      </div>

      <h2 className="section">خلاصه‌ی کاتالوگ</h2>
      <div className="grid g4">
        <div className="card"><div className="stat-label">محصولات قابل‌فروش</div><div className="stat-value">{num(s.sellable)}</div><div className="stat-foot">از مجموع {num(s.total)} · {num(s.hidden)} مخفی</div></div>
        <div className="card"><div className="stat-label">ارزش کل موجودی</div><div className="stat-value">{tomanShort(s.stock_value)}</div><div className="stat-foot">{num(s.units)} عدد کالا</div></div>
        <div className="card"><div className="stat-label">میانگین حاشیه سود</div><div className="stat-value">{pct(s.avg_margin, 0)}</div><div className="stat-foot">{num(s.profitable)} کالا پورسانت‌دار</div></div>
        <div className="card"><div className="stat-label">رو به اتمام</div><div className="stat-value" style={{ color: s.low ? 'var(--warn)' : undefined }}>{num(s.low)}</div><div className="stat-foot">موجودی زیر {num(LOW_STOCK)} عدد</div></div>
      </div>

      <div className="grid g2 section">
        <div className="card">
          <div className="card-head"><h2>تغییرات اخیر محصولات</h2><a className="badge b-info" href="/changes">{num(d.today)} مورد امروز · همه</a></div>
          {changes.length === 0 ? <div className="empty">هنوز تغییری ثبت نشده (از اجرای بعدی ثبت می‌شود)</div> : changes.map((e) => <EventRow key={e.id} e={e} />)}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2>هشدارهای باز</h2>
            {alerts.length === 0 ? (
              <div className="alert-row"><span className="badge b-ok">عادی</span><div><div>همه‌چیز عادی است</div><div className="sub">هیچ خطای ساختاری یا شکستی در آخرین اجرا ثبت نشده</div></div></div>
            ) : (
              <>
                {alerts.slice(0, 6).map((a, i) => <div className="alert-row" key={i}><div>{a.message}</div></div>)}
                <div className="sub">آخرین اجرا · {ago(h.last.started_at)}</div>
              </>
            )}
          </div>
          <div className="card">
            <h2>اجراهای اخیر</h2>
            <RunsChart runs={runs.map((r) => ({ ...r, started_at: r.started_at.toISOString() }))} />
          </div>
        </div>
      </div>
    </>
  );
}
