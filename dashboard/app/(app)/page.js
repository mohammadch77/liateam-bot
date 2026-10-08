import { q } from '@/lib/db';
import { getHealth } from '@/lib/health';
import { LOW_STOCK } from '@/lib/products';
import { num, pct, ago, duration, countdown, tomanShort, toman, shortDate } from '@/lib/format';
import RunsChart from '../components/RunsChart';
import DbError from '../components/DbError';
import FreshPill from '../components/FreshPill';
import { RunBadge } from '../components/badges';

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
    q(`SELECT * FROM (
         SELECT h.product_id, p.name, h.recorded_at, h.price,
                lag(h.price) OVER (PARTITION BY h.product_id ORDER BY h.recorded_at) AS prev
           FROM supplier_price_history h JOIN supplier_products p ON p.id = h.product_id) t
        WHERE prev IS NOT NULL AND prev <> price ORDER BY recorded_at DESC LIMIT 8`),
    q(`SELECT count(*)::int AS n FROM (
         SELECT h.recorded_at, h.price, lag(h.price) OVER (PARTITION BY h.product_id ORDER BY h.recorded_at) AS prev
           FROM supplier_price_history h) t
        WHERE prev IS NOT NULL AND prev <> price
          AND recorded_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran'`),
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
          <div className="card-head"><h2>تغییرات اخیر قیمت</h2><span className="badge b-info">{num(d.today)} مورد امروز</span></div>
          {changes.length === 0 ? <div className="empty">تغییری ثبت نشده</div> : changes.map((c, i) => {
            const delta = (c.price - c.prev) / c.prev;
            return (
              <div className="alert-row" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis">{c.name} <span className="sub tnum">#{num(c.product_id)}</span></div>
                  <div className="sub tnum">از <bdi>{toman(c.prev)}</bdi> به <b><bdi>{toman(c.price)}</bdi></b> تومان · <bdi>{ago(c.recorded_at)}</bdi></div>
                </div>
                <span className={`tnum ${delta > 0 ? 'neg' : 'pos'}`} dir="ltr">{pct(Math.abs(delta))}{delta > 0 ? '+' : '−'}</span>
              </div>
            );
          })}
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
