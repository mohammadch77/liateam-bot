'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeOrder } from './actions';
import { saveSetting } from '../settings/actions';

/** Dry run on/off. Switching it off is what makes «ثبت و پرداخت» create real Liateam orders. */
function DryRunToggle({ dryRun }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, start] = useTransition();
  const flip = () => start(async () => {
    await saveSetting('ordersDryRun', !dryRun);
    setAsk(false);
    router.refresh();
  });
  return (
    <div className="card">
      <h2>حالت آزمایشی سفارش</h2>
      <p className="sub">{dryRun ? 'روشن: سفارش تا قبل از ثبت نهایی در لیاتیم جلو می‌رود و آدرس ساخته‌شده دوباره حذف می‌شود.' : 'خاموش: سفارش‌ها واقعاً در لیاتیم ثبت می‌شوند.'}</p>
      {!ask ? <button type="button" className={`btn ${dryRun ? '' : 'btn-primary'}`} onClick={() => setAsk(true)}>{dryRun ? 'خاموش کردن (ثبت واقعی)' : 'روشن کردن حالت آزمایشی'}</button> : (
        <div className="banner bad">
          {dryRun ? 'از این به بعد «ثبت و پرداخت» سفارش واقعی در لیاتیم ثبت می‌کند. مطمئنید؟' : 'حالت آزمایشی روشن شود؟'}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={flip}>{busy ? '…' : 'بله'}</button>
            <button type="button" className="btn" onClick={() => setAsk(false)}>انصراف</button>
          </div>
        </div>
      )}
    </div>
  );
}

const nf = new Intl.NumberFormat('fa-IR');
const toman = (rial) => nf.format(Math.round(Number(rial) / 10));
const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const ITEM_STATUS = { ok: '', adjusted: 'تعداد کم شد', unavailable: 'ناموجود' };

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return json;
}

/** Test checkout: basket → live review → (simulated) payment → queued order. Same API the real site will call. */
function TestCheckout({ products }) {
  const router = useRouter();
  const [basket, setBasket] = useState([{ product_id: '', quantity: 1 }]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [addr, setAddr] = useState({ province_id: '', city_id: '', postal_code: '', address: '', plate: '', unit: '' });
  const [customer, setCustomer] = useState({ first_name: '', last_name: '', mobile: '' });
  const [payment, setPayment] = useState('gateway');
  const [review, setReview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, start] = useTransition();

  useEffect(() => { api('/api/test/geo').then((r) => (r.ok ? setProvinces(r.data) : setMsg({ bad: true, text: r.error }))); }, []);
  useEffect(() => {
    setCities([]);
    if (addr.province_id) api(`/api/test/geo?province_id=${addr.province_id}`).then((r) => r.ok && setCities(r.data));
  }, [addr.province_id]);

  const items = basket.filter((b) => b.product_id).map((b) => ({ product_id: Number(b.product_id), quantity: Number(toLatin(b.quantity)) || 1 }));
  const doReview = () => start(async () => {
    setMsg({ text: '⏳ در حال بررسی موجودی و قیمت در لیاتیم…' });
    const r = await api('/api/test/review', { city_id: Number(addr.city_id), items });
    setReview(r.ok ? { id: r.job_id, ...r.data } : null);
    setMsg(r.ok ? null : { bad: true, text: r.error });
  });
  const pay = () => start(async () => {
    setMsg({ text: '⏳ در حال ثبت سفارش…' });
    const r = await api('/api/test/orders', { review_id: review.id, payment, customer, address: { ...addr, postal_code: toLatin(addr.postal_code) } });
    if (r.ok) {
      setMsg({ text: `✅ سفارش #${r.data.order_id} در صف ثبت قرار گرفت و به مدیرها در بله خبر داده شد.` });
      setReview(null);
      router.refresh();
    } else setMsg({ bad: true, text: r.error });
  });
  const addAlternative = (alt) => setBasket((b) => [...b.filter((x) => x.product_id), { product_id: String(alt.product_id), quantity: 1 }]);
  const field = (obj, set, key, label, props = {}) => (
    <label className="field"><span>{label}</span>
      <input className="input" value={obj[key]} onChange={(e) => set({ ...obj, [key]: e.target.value })} {...props} /></label>
  );

  return (
    <div className="card">
      <h2>آزمایش خرید (مثل سایت)</h2>
      {msg && <div className={`banner ${msg.bad ? 'bad' : 'ok'}`}>{msg.text}</div>}
      <h3>۱. سبد</h3>
      {basket.map((b, i) => (
        <div key={i} className="row" style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <select className="input" style={{ flex: 1 }} value={b.product_id} onChange={(e) => setBasket(basket.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))}>
            <option value="">— محصول —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {toman(p.price)} ت{p.stock <= 0 ? ' · ناموجود' : ''}</option>)}
          </select>
          <input className="input tnum" style={{ width: 70 }} value={b.quantity} onChange={(e) => setBasket(basket.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label="تعداد" />
          <button type="button" className="btn btn-sm" onClick={() => setBasket(basket.filter((_, j) => j !== i))} aria-label="حذف">×</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => setBasket([...basket, { product_id: '', quantity: 1 }])}>+ قلم دیگر</button>

      <h3>۲. آدرس گیرنده</h3>
      <div className="grid g2">
        <label className="field"><span>استان</span>
          <select className="input" value={addr.province_id} onChange={(e) => setAddr({ ...addr, province_id: e.target.value, city_id: '' })}>
            <option value="">—</option>{provinces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="field"><span>شهر</span>
          <select className="input" value={addr.city_id} onChange={(e) => setAddr({ ...addr, city_id: e.target.value })}>
            <option value="">—</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        {field(customer, setCustomer, 'first_name', 'نام')}
        {field(customer, setCustomer, 'last_name', 'نام خانوادگی')}
        {field(customer, setCustomer, 'mobile', 'موبایل', { dir: 'ltr', placeholder: '09…' })}
        {field(addr, setAddr, 'postal_code', 'کد پستی', { dir: 'ltr' })}
        {field(addr, setAddr, 'plate', 'پلاک')}
        {field(addr, setAddr, 'unit', 'واحد')}
      </div>
      {field(addr, setAddr, 'address', 'آدرس')}
      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-primary" disabled={busy || !items.length || !addr.city_id} onClick={doReview}>مرور سفارش</button>
      </div>

      {review && (
        <>
          <h3>۳. مرور سفارش (قیمت و موجودی همین لحظه)</h3>
          <table>
            <thead><tr><th>محصول</th><th>تعداد</th><th>قیمت واحد (تومان)</th><th>جمع</th><th></th></tr></thead>
            <tbody>
              {review.items.map((it) => (
                <tr key={it.product_id}>
                  <td>{it.name ?? `#${it.product_id}`}{it.limited && <span className="badge b-warn"> موجودی محدود</span>}</td>
                  <td className="tnum">{nf.format(it.quantity)}{it.quantity !== it.requested && ` از ${nf.format(it.requested)}`}</td>
                  <td className="tnum">{it.unit_price != null ? toman(it.unit_price) : '—'}{it.price_changed && <div className="sub">قبلاً {toman(it.price_changed.old)}</div>}</td>
                  <td className="tnum">{it.line_total ? toman(it.line_total) : '—'}</td>
                  <td>{ITEM_STATUS[it.status] && <span className={`badge ${it.status === 'unavailable' ? 'b-bad' : 'b-warn'}`}>{ITEM_STATUS[it.status]}</span>}
                    {review.alternatives?.[it.product_id]?.length > 0 && (
                      <div className="sub">به‌جایش: {review.alternatives[it.product_id].map((a) => (
                        <button key={a.product_id} type="button" className="btn btn-sm" onClick={() => addAlternative(a)}>{a.name}</button>))}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>ارسال: {review.shipping ? `${review.shipping.title} · ${toman(review.shipping.price)} تومان` : '—'} · <b>جمع کل: {toman(review.total)} تومان</b></p>
          {!review.ok && <div className="banner bad">{review.reason}</div>}
          {review.ok && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="input" value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: 'auto' }}>
                <option value="gateway">درگاه (شبیه‌سازی پرداخت موفق)</option>
                <option value="wallet">کیف پول</option>
              </select>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={pay}>پرداخت و ثبت سفارش</button>
              <span className="sub">این مرور ۱۵ دقیقه معتبر است.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function OrdersClient({ products, orders, events, dryRun }) {
  const router = useRouter();
  const [msg, setMsg] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [, start] = useTransition();
  const place = (id) => start(async () => {
    setBusyId(id);
    setMsg({ text: `⏳ در حال ثبت سفارش #${id} در لیاتیم…` });
    const r = await placeOrder(id);
    setBusyId(null);
    if (r.error) setMsg({ bad: true, text: r.error });
    else if (r.dry_run) setMsg({ text: `🧪 حالت آزمایشی: سفارش #${id} تا قبل از ثبت نهایی جلو رفت (مبلغ لیاتیم ${toman(r.total)} تومان). جزئیات در رویدادها.` });
    else if (r.payment_url) { setMsg({ text: `✅ ثبت شد. لینک پرداخت باز شد و در بله هم ارسال شد.` }); window.open(r.payment_url, '_blank', 'noopener'); }
    else setMsg({ text: `وضعیت سفارش #${id}: ${r.status}` });
    router.refresh();
  });

  return (
    <>
      {msg && <div className={`banner ${msg.bad ? 'bad' : 'ok'}`}>{msg.text}</div>}
      <div className="card">
        <h2>صف سفارش‌ها</h2>
        {orders.length === 0 ? <p className="sub">هنوز سفارشی ثبت نشده است.</p> : (
          <table>
            <thead><tr><th>#</th><th>زمان</th><th>مشتری</th><th>اقلام</th><th>مبلغ (تومان)</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="tnum">{nf.format(o.id)}{o.urgent && ' ⚡️'}</td>
                  <td>{o.created}</td>
                  <td>{o.customer}</td>
                  <td>{o.items.map((i) => `${i.name} × ${nf.format(i.quantity)}${i.status === 'refunded' ? ' (برگشت)' : ''}`).join('، ')}</td>
                  <td className="tnum">{o.total}{o.refunded && <div className="sub">برگشت: {o.refunded}</div>}</td>
                  <td><span className={`badge ${o.statusClass}`}>{o.statusLabel}</span>
                    {o.liateamCode && <div className="sub">لیاتیم: {o.liateamCode}</div>}
                    {o.lastError && <div className="sub" style={{ color: 'var(--bad, #c33)' }}>{o.lastError}</div>}
                    {o.dryRunAt && o.status === 'queued' && <div className="sub">آزمایش: {o.dryRunAt}</div>}</td>
                  <td>
                    {o.status === 'queued' && <button type="button" className="btn btn-primary btn-sm" disabled={busyId != null} onClick={() => place(o.id)}>{busyId === o.id ? '…' : 'ثبت و پرداخت'}</button>}
                    {o.paymentUrl && <a className="btn btn-sm" href={o.paymentUrl} target="_blank" rel="noreferrer">پرداخت</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <TestCheckout products={products} />
      <DryRunToggle dryRun={dryRun} />
      <div className="card">
        <h2>رویدادهای سفارش</h2>
        {events.length === 0 ? <p className="sub">—</p> : events.map((e) => (
          <div key={e.id} style={{ borderBottom: '1px solid var(--line, #8883)', padding: '8px 0', whiteSpace: 'pre-line' }}>
            <span className="sub">{e.at}{e.orderId ? ` · #${nf.format(e.orderId)}` : ''}</span><div>{e.message}</div>
          </div>
        ))}
      </div>
    </>
  );
}
