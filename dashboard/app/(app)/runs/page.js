import { q } from '@/lib/db';
import { num, dateTime, duration, ago } from '@/lib/format';
import DbError from '../../components/DbError';
import { RunBadge } from '../../components/badges';

export const dynamic = 'force-dynamic';

const KIND = { auth: 'لاگین / توکن', structure: 'تغییر ساختار', coverage: 'پوشش ناقص', database: 'دیتابیس', error: 'خطای دیگر' };

export default async function RunsPage() {
  let runs, alerts, counts;
  try {
    [runs, alerts, [counts]] = await Promise.all([
      q('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100'),
      q(`SELECT a.*, r.started_at FROM sync_alerts a LEFT JOIN sync_runs r ON r.id = a.run_id ORDER BY a.id DESC LIMIT 100`),
      q(`SELECT count(*) FILTER (WHERE status='ok')::int ok, count(*) FILTER (WHERE status='warning')::int warning,
                count(*) FILTER (WHERE status='failed')::int failed FROM sync_runs WHERE started_at > now() - interval '7 days'`),
    ]);
  } catch (e) {
    return <DbError error={e} />;
  }
  return (
    <>
      <div className="page-head">
        <div><h1>اجراها و هشدار</h1>
          <div className="sub tnum">۷ روز اخیر: {num(counts.ok)} موفق · {num(counts.warning)} هشدار · {num(counts.failed)} شکست</div></div>
      </div>
      <div className="table-wrap" style={{ maxHeight: '52vh' }}>
        <table>
          <thead><tr>
            <th>زمان</th><th>وضعیت</th><th className="num">خوانده</th><th className="num">قابل‌فروش</th><th className="num">نوشته</th>
            <th className="num">رد</th><th className="num">مدت</th><th>نوع خطا</th><th>پیام</th>
          </tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={9} className="empty">هنوز اجرایی ثبت نشده</td></tr>}
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="tnum" title={ago(r.started_at)}>{dateTime(r.started_at)}</td>
                <td><RunBadge status={r.status} /></td>
                <td className="num">{num(r.fetched)}</td>
                <td className="num">{num(r.sellable)}</td>
                <td className="num">{num(r.written)}</td>
                <td className={`num ${r.rejected ? 'stock-low' : ''}`}>{num(r.rejected)}</td>
                <td className="num">{duration(r.duration_ms)}</td>
                <td>{r.failure_kind ? <span className="badge b-bad">{KIND[r.failure_kind] || r.failure_kind}</span> : '—'}</td>
                <td className="wrap sub" style={{ maxWidth: 420 }}>{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card section">
        <h2>لاگ هشدارها</h2>
        {alerts.length === 0 ? <div className="empty">هشداری ثبت نشده</div> : alerts.map((a) => (
          <div className="alert-row" key={a.id}>
            <span className={`badge ${a.level === 'failed' ? 'b-bad' : 'b-warn'}`}>{a.level === 'failed' ? 'شکست' : 'هشدار'}</span>
            <div style={{ flex: 1 }}>{a.message}</div>
            <span className="sub tnum">{dateTime(a.started_at ?? a.created_at)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
