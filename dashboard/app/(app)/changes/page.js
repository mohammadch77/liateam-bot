import { q } from '@/lib/db';
import { num } from '@/lib/format';
import DbError from '../../components/DbError';
import { EventRow, KINDS } from '../../components/events';
import MarkSeen from './MarkSeen';

export const dynamic = 'force-dynamic';

export default async function ChangesPage({ searchParams }) {
  const { kind = '', days = '7' } = await searchParams;
  const d = [1, 7, 30, 90].includes(Number(days)) ? Number(days) : 7;
  let events, counts;
  try {
    [events, counts] = await Promise.all([
      q(`SELECT * FROM product_events WHERE at > now() - make_interval(days => $1) AND ($2 = '' OR kind = $2)
          ORDER BY id DESC LIMIT 500`, [d, KINDS[kind] ? kind : '']),
      q(`SELECT kind, count(*)::int AS n FROM product_events WHERE at > now() - make_interval(days => $1) GROUP BY kind`, [d]),
    ]);
  } catch (e) {
    return <DbError error={e} />;
  }
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const link = (k, dd = d) => `/changes?${new URLSearchParams({ ...(k ? { kind: k } : {}), days: String(dd) })}`;

  return (
    <>
      <MarkSeen maxId={events[0]?.id ?? 0} />
      <div className="page-head">
        <div><h1>تغییرات محصولات</h1><div className="sub">هر تغییری که ربات در کاتالوگ لیاتیم دیده است: قیمت، موجودی، محصول جدید یا حذف‌شده</div></div>
        <div className="toolbar" style={{ margin: 0 }}>
          {[1, 7, 30, 90].map((x) => (
            <a key={x} className={`btn btn-sm${x === d ? ' btn-primary' : ''}`} href={link(kind, x)}>{x === 1 ? '۲۴ ساعت' : `${num(x)} روز`}</a>
          ))}
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 14, gap: 8 }}>
        <a className={`btn btn-sm${!kind ? ' btn-primary' : ''}`} href={link('')}>همه ({num(total)})</a>
        {Object.entries(KINDS).map(([k, [label]]) => (
          <a key={k} className={`btn btn-sm${kind === k ? ' btn-primary' : ''}`} href={link(k)}>{label} ({num(byKind[k] || 0)})</a>
        ))}
      </div>
      <div className="card">
        {events.length === 0 ? <div className="empty">در این بازه تغییری ثبت نشده</div> : events.map((e) => <EventRow key={e.id} e={e} />)}
      </div>
    </>
  );
}
