'use client';
import { useState, useTransition } from 'react';
import { saveSetting, requestRun } from './actions';

const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const fa = (v) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(v);
const showList = (v) => (v.length ? v.map(fa).join('، ') : 'خالی');

/** Chips with × and «+ افزودن»; every change goes through the confirm dialog. */
function ListEditor({ value, labels, onChange }) {
  const [adding, setAdding] = useState('');
  const add = () => {
    const n = Number(toLatin(adding.trim()));
    if (Number.isInteger(n) && n > 0 && !value.includes(n)) onChange([...value, n]);
    setAdding('');
  };
  return (
    <div className="chips" style={{ alignItems: 'center' }}>
      {value.map((c) => (
        <span key={c} className={`chip${labels && (!labels[c] || labels[c].startsWith('#')) ? ' unnamed' : ''}`} title={labels?.[c]}>
          {fa(c)}{labels?.[c] && !labels[c].startsWith('#') ? ` · ${labels[c]}` : ''}
          <button type="button" className="chip-x" aria-label={`حذف ${c}`} onClick={() => onChange(value.filter((x) => x !== c))}>×</button>
        </span>
      ))}
      <span className="chip-add">
        <input className="input tnum" dir="ltr" placeholder="کد" value={adding} onChange={(e) => setAdding(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} aria-label="کد جدید" />
        <button type="button" className="btn btn-sm" onClick={add}>+ افزودن</button>
      </span>
    </div>
  );
}

export default function SettingsForm({ values, categories, pending, account }) {
  const labels = Object.fromEntries(categories.map((c) => [c.code, c.label]));
  const [draft, setDraft] = useState({ priceJumpLimit: String(Math.round(values.priceJumpLimit * 100)), intervalHours: String(values.intervalHours) });
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, start] = useTransition();

  const ask = (key, title, to, fmt = showList) =>
    setConfirm({ title, from: fmt(values[key]), to: fmt(to), run: () => saveSetting(key, to) });
  const askNumber = (key, title, parse, fmt) => {
    const v = parse(Number(toLatin(draft[key])));
    if (v == null) return setMsg({ bad: true, text: `مقدار «${title}» نامعتبر است` });
    if (v === values[key]) return setMsg({ text: 'تغییری نکرده است' });
    ask(key, title, v, fmt);
  };
  const doIt = () => start(async () => {
    const r = await confirm.run();
    setConfirm(null);
    setMsg(r.error ? { bad: true, text: r.error } : { text: 'اعمال شد و در گزارش ثبت شد' });
  });

  return (
    <>
      {msg && <div className={`banner ${msg.bad ? 'bad' : 'ok'}`}>{msg.text}</div>}
      <div className="grid g2">
        <div className="card">
          <h2>تنظیمات ربات</h2>
          <div className="sub" style={{ marginTop: -6, marginBottom: 6 }}>هر تغییر قبل از اعمال تأیید می‌گیرد و در گزارش ثبت می‌شود.</div>
          <div className="kv">
            <div className="k">فاصله‌ی زمان‌بندی<small>هر چند ساعت یک‌بار اجرا شود · ۰٫۲۵ (۱۵ دقیقه) تا ۱۶۸ · ظرف ۳۰ ثانیه اعمال می‌شود</small></div>
            <div className="chip-add" style={{ alignItems: 'center' }}>
              <input id="intervalHours" className="input tnum" dir="ltr" value={draft.intervalHours} onChange={(e) => setDraft({ ...draft, intervalHours: e.target.value })} />
              <span>ساعت</span>
              <button className="btn btn-sm" type="button" onClick={() => askNumber('intervalHours', 'فاصله‌ی زمان‌بندی', (n) => (n >= 0.25 && n <= 168 ? n : null), (v) => `${fa(v)} ساعت`)}>اعمال…</button>
            </div>
          </div>
          <div className="kv">
            <div className="k">آستانه‌ی جهش قیمت<small>بیش از این درصد = رد و هشدار</small></div>
            <div className="chip-add" style={{ alignItems: 'center' }}>
              <input id="priceJumpLimit" className="input tnum" dir="ltr" value={draft.priceJumpLimit} onChange={(e) => setDraft({ ...draft, priceJumpLimit: e.target.value })} />
              <span>٪</span>
              <button className="btn btn-sm" type="button" onClick={() => askNumber('priceJumpLimit', 'آستانه‌ی جهش قیمت', (n) => (n > 0 && n <= 1000 ? n / 100 : null), (v) => `${fa(Math.round(v * 100))}٪`)}>اعمال…</button>
            </div>
          </div>
          <div className="kv" style={{ display: 'block' }}>
            <div className="k" style={{ marginBottom: 8 }}>دسته‌های کنارگذاشته‌شده<small>اقلام تبلیغاتی و نمونه — محصولاتشان «مخفی» می‌شوند</small></div>
            <ListEditor value={values.excludedCategories} labels={labels} onChange={(v) => ask('excludedCategories', 'دسته‌های کنارگذاشته‌شده', v)} />
          </div>
          <div className="kv" style={{ display: 'block' }}>
            <div className="k" style={{ marginBottom: 8 }}>محصولات استثنا (قابل‌فروش)<small>کد محصولاتی که داخل دسته‌ی کنارگذاشته هستند ولی فروخته می‌شوند</small></div>
            <ListEditor value={values.sellableOverrides} onChange={(v) => ask('sellableOverrides', 'محصولات استثنا', v)} />
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2>حساب لیاتیم و هشدار</h2>
            <div className="sub" style={{ marginTop: -6, marginBottom: 6 }}>فقط خواندنی — این مقادیر در .env سرور ربات هستند و از داشبورد تغییر نمی‌کنند.</div>
            <div className="kv"><div className="k">نام کاربری لیاتیم<small>برای لاگین خودکار ربات</small></div><span className="mono" dir="ltr">{account.username || '—'}</span></div>
            <div className="kv"><div className="k">رمز عبور لیاتیم<small>هیچ‌وقت نمایش داده نمی‌شود</small></div>
              <span className={`badge ${account.passwordSet ? 'b-ok' : 'b-bad'}`}>{account.passwordSet == null ? 'نامشخص' : account.passwordSet ? 'تنظیم‌شده' : 'تنظیم نشده'}</span></div>
            <div className="kv"><div className="k">کانال هشدار<small>پیام شکست و خطا کجا برود</small></div>
              <span className={`badge ${account.telegram ? 'b-ok' : 'b-warn'}`}>تلگرام {account.telegram ? 'فعال' : 'تنظیم نشده'}</span></div>
          </div>
          <div className="card">
            <h2>اجرای دستی</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" type="button" disabled={!!pending}
                onClick={() => setConfirm({ title: 'اجرای دستی همگام‌سازی', text: 'ربات (با worker فعال) ظرف حدود ۳۰ ثانیه یک اجرای کامل انجام می‌دهد.', run: requestRun })}>
                اجرای دستی…
              </button>
              {pending && <span className="sub">در صف از {pending.at} ({pending.by})</span>}
            </div>
          </div>
        </div>
      </div>

      {confirm && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal">
            <h2 id="confirm-title">تأیید: {confirm.title}</h2>
            {confirm.text ? <p>{confirm.text}</p> : (
              <div className="diff tnum"><div>قبل: <span className="old">{confirm.from}</span></div><div>بعد: <span className="new">{confirm.to}</span></div></div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setConfirm(null)} disabled={busy}>انصراف</button>
              <button className="btn btn-primary" type="button" onClick={doIt} disabled={busy}>{busy ? '…' : 'تأیید و اعمال'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
