import { q } from '@/lib/db';
import { num, dateTime } from '@/lib/format';

/** Progress and findings of the one-time product audit (each product checked once on its own page). */
export default async function AuditCard({ total }) {
  let s, issues;
  try {
    [[s], issues] = await Promise.all([
      q(`SELECT count(*) FILTER (WHERE ok)::int AS done, count(*) FILTER (WHERE NOT ok AND attempts >= 3)::int AS unreadable,
                count(*) FILTER (WHERE array_length(prices, 1) > 1)::int AS multi,
                count(*) FILTER (WHERE array_length(missing_variants, 1) > 0)::int AS missing,
                count(*) FILTER (WHERE price_matches = false)::int AS mismatch, max(checked_at) AS last
           FROM product_audit`),
      q(`SELECT a.product_id, p.name, a.prices, a.missing_variants, a.price_matches
           FROM product_audit a LEFT JOIN supplier_products p ON p.id = a.product_id
          WHERE array_length(a.prices, 1) > 1 OR array_length(a.missing_variants, 1) > 0 OR a.price_matches = false
          ORDER BY a.product_id LIMIT 20`),
    ]);
  } catch {
    return null; // table not created yet (bot not updated)
  }
  const checked = s.done + s.unreadable;
  const complete = total > 0 && checked >= total;
  const pct = total ? Math.min(100, Math.round((checked / total) * 100)) : 0;
  const clean = !s.multi && !s.missing && !s.mismatch;
  return (
    <div className="card section">
      <div className="card-head">
        <h2>بازبینی کامل محصولات</h2>
        <span className={`badge ${!complete ? 'b-info' : clean ? 'b-ok' : 'b-warn'}`}>
          {!complete ? 'در حال انجام' : clean ? 'تمام شد · همه درست' : 'تمام شد · نیاز به بررسی'}
        </span>
      </div>
      <div className="sub" style={{ marginBottom: 10 }}>
        صفحه‌ی هر محصول یک‌بار جداگانه بررسی می‌شود: مدل‌ها و رنگ‌ها، قیمت جدا برای هر مدل، و یکی بودن قیمت با فهرست.
        در هر اجرای ربات فقط ۱۰ محصول، و بعد از اتمام دیگر تکرار نمی‌شود.
      </div>
      <div className="fresh">
        <div className="fresh-bar"><span style={{ width: `${Math.max(3, pct)}%`, background: complete && !clean ? 'var(--warn)' : 'var(--ok)' }} /></div>
        <div className="tnum" style={{ minWidth: 230 }}>{num(checked)} از {num(total)} محصول ({num(pct)}٪){s.last ? ` · آخرین: ${dateTime(s.last)}` : ''}</div>
      </div>
      <div className="chips" style={{ marginTop: 12, gap: 8 }}>
        <span className={`badge ${s.multi ? 'b-warn' : 'b-ok'}`}>چند مدل با قیمت جدا: {num(s.multi)}</span>
        <span className={`badge ${s.missing ? 'b-warn' : 'b-ok'}`}>مدل جاافتاده: {num(s.missing)}</span>
        <span className={`badge ${s.mismatch ? 'b-warn' : 'b-ok'}`}>قیمت متفاوت با صفحه: {num(s.mismatch)}</span>
        {s.unreadable > 0 && <span className="badge b-hidden">صفحه باز نشد: {num(s.unreadable)}</span>}
      </div>
      {issues.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {issues.map((i) => (
            <div className="alert-row" key={i.product_id}>
              <span className="badge b-warn">کد {num(i.product_id)}</span>
              <div style={{ flex: 1 }}>
                {i.name}
                <div className="sub tnum">
                  {i.prices?.length > 1 && `مدل‌ها با قیمت‌های: ${i.prices.map((p) => num(Math.round(p / 10))).join('، ')} تومان. `}
                  {i.missing_variants?.length > 0 && `مدل‌های خارج از فهرست: ${i.missing_variants.join('، ')}. `}
                  {i.price_matches === false && 'قیمت صفحه با فهرست فرق دارد.'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
