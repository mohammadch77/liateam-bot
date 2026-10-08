import { q } from '@/lib/db';
import { getStatus } from '@/lib/data';
import { num, pct, duration, ago, runStamp } from '@/lib/format';
import DbError from '../../components/DbError';
import { RunBadge } from '../../components/badges';

export const dynamic = 'force-dynamic';

const KIND = { auth: 'لاگین / توکن', structure: 'تغییر ساختار صفحه', coverage: 'پوشش ناقص', database: 'دیتابیس در دسترس نبود', error: 'خطای دیگر' };

function summary(r) {
  if (r.status === 'failed') return `${KIND[r.failure_kind] || 'شکست'} · داده‌ای نوشته نشد`;
  const parts = [`${num(r.fetched)} خوانده`, `${num(r.sellable)} قابل‌فروش`, `${num(r.rejected)} رد`, duration(r.duration_ms)];
  return parts.join(' · ');
}

export default async function RunsPage() {
  let runs, alerts, week, status;
  try {
    [runs, alerts, [week], status] = await Promise.all([
      q('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100'),
      q(`SELECT a.*, r.started_at FROM sync_alerts a LEFT JOIN sync_runs r ON r.id = a.run_id ORDER BY a.id DESC LIMIT 100`),
      q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status <> 'failed')::int AS good,
                avg(duration_ms) FILTER (WHERE status <> 'failed') AS avg_ms, round(avg(fetched) FILTER (WHERE status <> 'failed'))::int AS avg_fetched
           FROM sync_runs WHERE started_at > now() - interval '7 days'`),
      getStatus(),
    ]);
  } catch (e) {
    return <DbError error={e} />;
  }
  const tg = status.telegram?.configured;
  return (
    <>
      <div className="page-head">
        <div><h1>اجراها و هشدار</h1><div className="sub">تاریخچه‌ی اجرای ربات و هشدارهای ارسال‌شده</div></div>
      </div>
      <div className="grid g4" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="card">
          <div className="stat-label">اجراهای موفق (۷ روز)</div>
          <div className="stat-value">{num(week.good)} / {num(week.total)}</div>
          <div className="stat-foot">{week.total ? `${pct(week.good / week.total, 0)} نرخ موفقیت` : 'اجرایی ثبت نشده'}</div>
        </div>
        <div className="card">
          <div className="stat-label">میانگین مدت اجرا</div>
          <div className="stat-value">{duration(week.avg_ms)}</div>
          <div className="stat-foot">{week.avg_fetched != null ? `${num(Math.ceil(week.avg_fetched / 19))} صفحه · ${num(week.avg_fetched)} محصول` : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">کانال هشدار</div>
          <div className="stat-value" style={{ color: tg ? 'var(--ok)' : 'var(--warn)' }}>تلگرام {tg ? 'فعال' : 'تنظیم نشده'}</div>
          <div className="stat-foot">{tg ? 'توکن و chat_id روی سرور ربات تنظیم است' : 'هشدارها فقط در logs/alerts.log ثبت می‌شوند'}</div>
        </div>
      </div>

      <div className="grid g2 section">
        <div className="card">
          <h2>تاریخچه اجراها</h2>
          {runs.length === 0 && <div className="empty">هنوز اجرایی ثبت نشده</div>}
          {runs.map((r) => (
            <div className="run-item" key={r.id}>
              <RunBadge status={r.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tnum">{runStamp(r.started_at)}</div>
                <div className="sub tnum">{summary(r)}</div>
                {r.status === 'failed' && r.message && <div className="sub ellipsis" title={r.message}>{r.message}</div>}
              </div>
              <span className="sub tnum" style={{ whiteSpace: 'nowrap' }}>{ago(r.started_at)}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ alignSelf: 'start' }}>
          <h2>لاگ هشدارها</h2>
          {alerts.length === 0 ? <div className="empty">هشداری ثبت نشده</div> : alerts.map((a) => (
            <div className="alert-row" key={a.id}>
              <span className={`badge ${a.level === 'failed' ? 'b-bad' : 'b-warn'}`}>{a.level === 'failed' ? 'شکست' : 'هشدار'}</span>
              <div style={{ flex: 1 }}>{a.message}</div>
              <span className="sub tnum" style={{ whiteSpace: 'nowrap' }}>{ago(a.started_at ?? a.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
