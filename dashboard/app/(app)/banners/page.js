import { q } from '@/lib/db';
import { getStatus } from '@/lib/data';
import { ago, dateTime, num } from '@/lib/format';
import DbError from '../../components/DbError';
import BannerInterval from './BannerInterval';

export const dynamic = 'force-dynamic';

const REASON = {
  'no-link': 'لینک ندارد', external: 'لینک به سایت دیگر', 'no-page': 'مقصد در سایت ما صفحه ندارد',
  'bad-image': 'عکس از هاست لیاتیم نیست', 'unknown-product': 'محصولش در کاتالوگ ما نیست', 'unknown-category': 'دسته‌اش در کاتالوگ ما نیست',
};

/**
 * Home-page banners mirrored from Liateam (hero_slides): what is shown now and where each one leads, when they were
 * last checked and last changed, what was skipped and why, the change history, and how often they are checked
 * (the same setting as «زمان‌بندی» in settings and in the bots).
 */
export default async function BannersPage() {
  let slides, history, status;
  try {
    [slides, history, status] = await Promise.all([
      q(`SELECT h.position, h.image_url, h.portrait_url, h.color, h.alt, h.target_type, h.target_code, h.updated_at,
                p.name AS product_name, c.name AS category_name
           FROM hero_slides h
           LEFT JOIN supplier_products p ON h.target_type = 'product' AND p.id = h.target_code
           LEFT JOIN categories c ON h.target_type = 'category' AND c.code = h.target_code
          ORDER BY h.position`),
      q(`SELECT id, occurred_at, summary_fa, notified_at FROM change_events WHERE event_type = 'banner_changed'
          ORDER BY id DESC LIMIT 30`).catch(() => []),
      getStatus(),
    ]);
  } catch (e) {
    return <DbError error={e} />;
  }
  const hero = status.hero ?? {};
  const worker = status.worker ?? {};
  const minutes = worker.schedule?.windows?.find((w) => w.name === 'day')?.minutes?.hero ?? 30;

  return (
    <>
      <div className="page-head">
        <div><h1>بنرهای صفحه‌ی اصلی</h1><div className="sub">اسلایدهای صفحه‌ی اصلی لیاتیم که ربات خوانده و در سایت ما نمایش داده می‌شوند</div></div>
      </div>

      <div className="grid g3">
        <div className="card">
          <div className="stat-label">بنرهای نمایش‌داده‌شده</div>
          <div className="stat-value">{num(slides.length)}</div>
          <div className="stat-foot">{hero.skipped?.length ? `${num(hero.skipped.length)} بنر رد شد (پایین)` : 'بنری رد نشد'}</div>
        </div>
        <div className="card">
          <div className="stat-label">آخرین بررسی</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{hero.checked_at ? ago(hero.checked_at) : '—'}</div>
          <div className="stat-foot">آخرین تغییر: {hero.changed_at ? `${dateTime(hero.changed_at)} (${ago(hero.changed_at)})` : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">بررسی بعدی</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{worker.next_run_at?.hero ? dateTime(worker.next_run_at.hero) : '—'}</div>
          <div className="stat-foot">{worker.paused ? 'زمان‌بندی موقتاً متوقف است' : worker.window === 'night' ? 'شب: ربات خواب است' : `هر ~${num(minutes)} دقیقه (±۲۰٪)`}</div>
        </div>
      </div>

      <BannerInterval minutes={minutes} />

      <div className="card section">
        <h2>بنرهای فعلی (به ترتیب لیاتیم)</h2>
        {slides.length === 0 ? <div className="empty">بنری ذخیره نشده — سایت هیروی پیش‌فرض را نشان می‌دهد</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>تصویر</th><th>مقصد در سایت ما</th><th>به‌روزشده</th></tr></thead>
            <tbody>
              {slides.map((s) => (
                <tr key={s.position}>
                  <td className="tnum">{num(s.position + 1)}</td>
                  <td>
                    <a href={s.image_url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private admin page, Liateam's image host */}
                      <img src={s.image_url} alt={s.alt ?? ''} width={192} height={80} loading="lazy"
                        style={{ width: 192, height: 80, objectFit: 'cover', borderRadius: 8, background: s.color ?? '#eee' }} />
                    </a>
                  </td>
                  <td>
                    {s.target_type === 'product' ? 'محصول' : 'دسته'} {num(s.target_code)}
                    <div className="sub">{s.product_name ?? s.category_name ?? '—'}</div>
                  </td>
                  <td className="sub tnum">{ago(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="grid g2 section">
        <div className="card" style={{ alignSelf: 'start' }}>
          <h2>بنرهای ردشده</h2>
          {!hero.skipped?.length ? <div className="empty">همه‌ی بنرهای لیاتیم در سایت ما مقصد دارند</div> : hero.skipped.map((x, i) => (
            <div className="alert-row" key={i}>
              <span className="badge b-warn">{REASON[x.reason] ?? x.reason}</span>
              <div style={{ flex: 1 }}>{x.title ?? '—'} <span className="sub mono" dir="ltr">{x.link ?? ''}</span></div>
            </div>
          ))}
        </div>
        <div className="card" style={{ alignSelf: 'start' }}>
          <h2>تاریخچه‌ی تغییر بنرها</h2>
          {history.length === 0 ? <div className="empty">از زمان ثبت رویدادها، بنرها تغییری نکرده‌اند</div> : history.map((h) => (
            <div className="alert-row" key={h.id}>
              <span className="badge b-ok">تغییر کرد</span>
              <div style={{ flex: 1 }}>{h.summary_fa}<div className="sub">{h.notified_at ? 'در ربات اعلام شد' : 'در صف اعلام'}</div></div>
              <span className="sub tnum row-time">{dateTime(h.occurred_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
