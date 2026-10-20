import { q } from '@/lib/db';
import { num } from '@/lib/format';
import DbError from '../../../components/DbError';

export const dynamic = 'force-dynamic';

// change_events types (src/change-events.mjs), in display order
const TYPES = {
  price_changed: 'تغییر قیمت', stock_changed: 'تغییر موجودی', product_added: 'محصول جدید', product_removed: 'حذف از لیاتیم',
  product_returned: 'برگشت به لیاتیم', name_changed: 'تغییر نام', description_changed: 'توضیحات', features_changed: 'ویژگی‌ها',
  specs_changed: 'مشخصات', how_to_use_changed: 'نحوه‌ی مصرف', video_changed: 'ویدیو', faq_changed: 'پرسش‌ها',
  reviews_changed: 'نظرات', gallery_changed: 'گالری', images_changed: 'عکس اصلی', facts_changed: 'حجم/ماندگاری',
  concerns_changed: '«مناسب برای»', banner_changed: 'بنرها', sync_backoff: 'عقب‌نشینی ربات',
};
const when = (d) => new Date(d).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' });

/** Every change the bot wrote (change_events), newest first, with whether it was announced in the bots yet. */
export default async function ChangeEventsPage({ searchParams }) {
  const { type = '', days = '7' } = await searchParams;
  const d = [1, 7, 30, 90].includes(Number(days)) ? Number(days) : 7;
  const t = TYPES[type] ? type : '';
  let events, counts;
  try {
    [events, counts] = await Promise.all([
      q(`SELECT id, occurred_at, entity_type, product_code, event_type, summary_fa, notified_at FROM change_events
          WHERE occurred_at > now() - make_interval(days => $1) AND ($2 = '' OR event_type = $2) ORDER BY id DESC LIMIT 500`, [d, t]),
      q(`SELECT event_type, count(*)::int AS n FROM change_events WHERE occurred_at > now() - make_interval(days => $1) GROUP BY event_type`, [d]),
    ]);
  } catch (e) {
    return <DbError error={e} />;
  }
  const byType = Object.fromEntries(counts.map((c) => [c.event_type, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const link = (tt, dd = d) => `/changes/events?${new URLSearchParams({ ...(tt ? { type: tt } : {}), days: String(dd) })}`;
  return (
    <>
      <div className="page-head">
        <div><h1>همه‌ی رویدادها</h1><div className="sub">هر تغییری که ربات نوشته: قیمت، موجودی، محتوا، عکس، بنرها و عقب‌نشینی‌ها · <a href="/changes">فقط قیمت و موجودی ←</a></div></div>
        <div className="toolbar" style={{ margin: 0 }}>
          {[1, 7, 30, 90].map((x) => (
            <a key={x} className={`btn btn-sm${x === d ? ' btn-primary' : ''}`} href={link(t, x)}>{x === 1 ? '۲۴ ساعت' : `${num(x)} روز`}</a>
          ))}
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 14, gap: 8 }}>
        <a className={`btn btn-sm${!t ? ' btn-primary' : ''}`} href={link('')}>همه ({num(total)})</a>
        {Object.entries(TYPES).filter(([k]) => byType[k]).map(([k, label]) => (
          <a key={k} className={`btn btn-sm${t === k ? ' btn-primary' : ''}`} href={link(k)}>{label} ({num(byType[k])})</a>
        ))}
      </div>
      <div className="card">
        {events.length === 0 ? <div className="empty">در این بازه رویدادی ثبت نشده</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>زمان</th><th>نوع</th><th>محصول</th><th>شرح</th><th>اعلام در ربات</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="tnum">{when(e.occurred_at)}</td>
                  <td>{TYPES[e.event_type] ?? e.event_type}</td>
                  <td className="tnum">{e.product_code ? num(e.product_code) : e.entity_type === 'banner' ? 'بنر' : '—'}</td>
                  <td>{e.summary_fa}</td>
                  <td>{e.notified_at ? when(e.notified_at) : 'در صف'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
