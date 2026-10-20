import { q } from '@/lib/db';
import { getStatus } from '@/lib/data';
import { num, pct, duration, ago, runStamp } from '@/lib/format';
import DbError from '../../components/DbError';
import { RunBadge } from '../../components/badges';

export const dynamic = 'force-dynamic';

const KIND = { auth: 'لاگین / توکن', structure: 'تغییر ساختار صفحه', coverage: 'پوشش ناقص', database: 'دیتابیس در دسترس نبود',
  blocked: 'لیاتیم درخواست‌ها را رد کرد (عقب‌نشینی)', error: 'خطای دیگر' };
// what a run did (sync_runs.tasks; runs before the window schedule have none = a full run)
const TASK = { catalog: 'قیمت و موجودی', hero: 'بنرها', details: 'محتوای سنگین' };
const tasksText = (r) => (r.tasks?.length ? r.tasks.map((t) => TASK[t] ?? t).join(' + ') : 'کامل');

function summary(r) {
  if (r.status === 'failed') return `${KIND[r.failure_kind] || 'شکست'} · داده‌ای نوشته نشد`;
  if (r.tasks?.length && !r.tasks.includes('catalog')) return duration(r.duration_ms);
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
  const bots = [['bale', 'بله'], ['telegram', 'تلگرام']].filter(([p]) => status[`messenger_${p}`]?.enabled);
  const connected = bots.filter(([p]) => status[`messenger_${p}`]?.ok);
  return (
    <>
      <div className="page-head">
        <div><h1>اجراها و هشدار</h1><div className="sub">تاریخچه‌ی اجرای ربات و هشدارهای ارسال‌شده · هر اجرا با کاری که انجام داد (قیمت و موجودی، بنرها، محتوای سنگین)</div></div>
      </div>
      <div className="grid g3">
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
          <div className="stat-value" style={{ color: connected.length ? 'var(--ok)' : 'var(--warn)' }}>
            {connected.length ? connected.map(([, l]) => l).join(' و ') : bots.length ? 'قطع' : 'خاموش'}
          </div>
          <div className="stat-foot">{connected.length ? 'اعلان‌ها به کاربران متصل فرستاده می‌شود' : 'از تنظیمات، ربات بله یا تلگرام را روشن کنید'}</div>
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
                <div className="tnum">{runStamp(r.started_at)} <span className="badge b-info" style={{ marginInlineStart: 6 }}>{tasksText(r)}</span></div>
                <div className="sub tnum">{summary(r)}</div>
                {r.status === 'failed' && r.message && <div className="sub ellipsis" title={r.message}>{r.message}</div>}
              </div>
              <span className="sub tnum row-time">{ago(r.started_at)}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ alignSelf: 'start' }}>
          <h2>لاگ هشدارها</h2>
          {alerts.length === 0 ? <div className="empty">هشداری ثبت نشده</div> : alerts.map((a) => (
            <div className="alert-row" key={a.id}>
              <span className={`badge ${a.level === 'failed' ? 'b-bad' : 'b-warn'}`}>{a.level === 'failed' ? 'شکست' : 'هشدار'}</span>
              <div style={{ flex: 1 }}>{a.message}</div>
              <span className="sub tnum row-time">{ago(a.started_at ?? a.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
