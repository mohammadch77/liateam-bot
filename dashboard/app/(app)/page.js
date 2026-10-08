import { q } from '@/lib/db';
import { getHealth } from '@/lib/health';
import { LOW_STOCK } from '@/lib/products';
import { num, rial, pct, ago, dateTime } from '@/lib/format';
import RunsChart from '../components/RunsChart';
import DbError from '../components/DbError';
import { RunBadge } from '../components/badges';

export const dynamic = 'force-dynamic';

async function load() {
  const [health, [summary], changes, runs] = await Promise.all([
    getHealth(),
    q(`SELECT count(*) FILTER (WHERE is_sellable)::int AS sellable,
              count(*) FILTER (WHERE NOT is_sellable)::int AS hidden,
              count(*) FILTER (WHERE is_sellable AND stock <= 0)::int AS out,
              count(*) FILTER (WHERE is_sellable AND stock > 0 AND stock <= $1)::int AS low,
              COALESCE(sum(cost_price * stock) FILTER (WHERE is_sellable AND stock > 0), 0) AS stock_value,
              avg((price - cost_price)::numeric / NULLIF(price, 0)) FILTER (WHERE is_sellable) AS avg_margin,
              avg(price - cost_price) FILTER (WHERE is_sellable) AS avg_profit
         FROM supplier_products`, [LOW_STOCK]),
    q(`SELECT * FROM (
         SELECT h.product_id, p.name, h.recorded_at, h.price,
                lag(h.price) OVER (PARTITION BY h.product_id ORDER BY h.recorded_at) AS prev
           FROM supplier_price_history h JOIN supplier_products p ON p.id = h.product_id) t
        WHERE prev IS NOT NULL AND prev <> price ORDER BY recorded_at DESC LIMIT 10`),
    q(`SELECT started_at, status, fetched, sellable, rejected FROM sync_runs ORDER BY started_at DESC LIMIT 20`),
  ]);
  return { health, summary, changes, runs: runs.reverse() };
}

const FRESH = { ok: ['b-ok', 'تازه', 'var(--ok)'], warn: ['b-warn', 'کمی قدیمی', 'var(--warn)'], bad: ['b-bad', 'قدیمی', 'var(--bad)'] };

export default async function Overview() {
  let d;
  try { d = await load(); } catch (e) { return <DbError error={e} />; }
  const { health: h, summary: s, changes, runs } = d;
  const session = h.status.session;
  const [fCls, fLabel, fColor] = FRESH[h.freshness];

  return (
    <>
      <div className="page-head">
        <div><h1>نمای کلی</h1><div className="sub">وضعیت ربات و خلاصه‌ی کاتالوگ</div></div>
      </div>

      <div className="grid g4">
        <div className="card">
          <div className="stat-label">آخرین اجرا {h.last && <RunBadge status={h.last.status} />}</div>
          <div className="stat-value">{h.last ? ago(h.last.started_at) : 'هنوز اجرا نشده'}</div>
          <div className="stat-foot">{h.last ? dateTime(h.last.started_at) : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">اجرای بعدی <span className={`badge ${h.workerAlive ? 'b-ok' : 'b-warn'}`}>{h.workerAlive ? 'worker فعال' : 'worker خاموش'}</span></div>
          <div className="stat-value">{h.nextRun ? ago(h.nextRun) : '—'}</div>
          <div className="stat-foot">هر {num(h.intervalH)} ساعت{!h.workerAlive && ' · تخمینی (زمان‌بندی بیرونی)'}</div>
        </div>
        <div className="card">
          <div className="stat-label">سشن / توکن لیاتیم
            <span className={`badge ${!session ? 'b-hidden' : session.ok && session.present ? 'b-ok' : 'b-bad'}`}>
              {!session ? 'نامشخص' : session.ok && session.present ? 'معتبر' : 'نیاز به لاگین'}</span>
          </div>
          <div className="stat-value">{session?.expires_at ? `انقضا ${ago(session.expires_at)}` : session?.present ? 'بدون تاریخ انقضا' : '—'}</div>
          <div className="stat-foot">بررسی {ago(session?.checked_at)} · تلگرام: {h.status.telegram?.configured ? 'تنظیم شده' : 'تنظیم نشده'}</div>
        </div>
        <div className="card">
          <div className="stat-label">اتصال دیتابیس <span className="badge b-ok">متصل</span></div>
          <div className="stat-value">PostgreSQL</div>
          <div className="stat-foot">پرس‌وجوی این صفحه موفق بود</div>
        </div>
      </div>

      <div className="card section">
        <div className="stat-label" style={{ marginBottom: 10 }}>تازگی داده <span className={`badge ${fCls}`}>{fLabel}</span></div>
        <div className="fresh">
          <div className="fresh-bar"><span style={{ width: `${Math.max(4, 100 - Math.min(1, h.ratio / 2) * 100)}%`, background: fColor }} /></div>
          <div className="tnum" style={{ minWidth: 220 }}>
            آخرین داده‌ی معتبر: {h.lastGood ? ago(h.lastGood.started_at) : 'ندارد'}
          </div>
        </div>
      </div>

      <div className="grid g4 section">
        <div className="card"><div className="stat-label">محصولات قابل‌فروش</div><div className="stat-value">{num(s.sellable)}</div><div className="stat-foot">{num(s.hidden)} مخفی · {num(s.out)} ناموجود</div></div>
        <div className="card"><div className="stat-label">ارزش کل موجودی</div><div className="stat-value">{rial(s.stock_value)}</div><div className="stat-foot">ریال، به قیمت تمام‌شده</div></div>
        <div className="card"><div className="stat-label">میانگین سود</div><div className="stat-value">{pct(s.avg_margin)}</div><div className="stat-foot">{rial(s.avg_profit)} ریال در هر محصول</div></div>
        <div className="card"><div className="stat-label">رو به اتمام</div><div className="stat-value" style={{ color: s.low ? 'var(--warn)' : undefined }}>{num(s.low)}</div><div className="stat-foot">موجودی ۱ تا {num(LOW_STOCK)}</div></div>
      </div>

      <div className="grid g2 section">
        <div className="card">
          <h2>اجراهای اخیر</h2>
          <RunsChart runs={runs.map((r) => ({ ...r, started_at: r.started_at.toISOString() }))} />
        </div>
        <div className="card">
          <h2>تغییرات اخیر قیمت</h2>
          {changes.length === 0 ? <div className="empty">تغییری ثبت نشده</div> : changes.map((c, i) => {
            const delta = (c.price - c.prev) / c.prev;
            return (
              <div className="alert-row" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div className="sub tnum"><bdi>{rial(c.prev)}</bdi> ← <bdi>{rial(c.price)}</bdi> ریال · <bdi>{ago(c.recorded_at)}</bdi></div>
                </div>
                <span className={`tnum ${delta > 0 ? 'neg' : 'pos'}`}>{delta > 0 ? '▲' : '▼'} {pct(Math.abs(delta))}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
