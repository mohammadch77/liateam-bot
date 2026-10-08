'use client';
import { useState, useTransition } from 'react';
import { saveSetting, requestRun } from './actions';

const parseList = (s) => {
  const parts = s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).split(/[\s,،]+/).filter(Boolean);
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n) && n > 0) ? [...new Set(nums)] : null;
};
const show = (v) => (Array.isArray(v) ? (v.length ? v.join('، ') : 'خالی') : String(v));

export default function SettingsForm({ values, categories, pending }) {
  const label = Object.fromEntries(categories.map((c) => [c.code, c.label]));
  const [draft, setDraft] = useState({
    excludedCategories: values.excludedCategories.join(', '),
    sellableOverrides: values.sellableOverrides.join(', '),
    priceJumpLimit: String(Math.round(values.priceJumpLimit * 100)),
    intervalHours: String(values.intervalHours),
  });
  const [confirm, setConfirm] = useState(null); // { key, title, from, to, run }
  const [msg, setMsg] = useState(null);
  const [busy, start] = useTransition();

  const FIELDS = {
    excludedCategories: { title: 'دسته‌های مستثنا', parse: parseList },
    sellableOverrides: { title: 'استثناهای قابل‌فروش (کد محصول)', parse: parseList },
    priceJumpLimit: { title: 'آستانه‌ی جهش قیمت', parse: (s) => { const n = Number(s); return n > 0 && n <= 1000 ? n / 100 : null; }, fmt: (v) => `${Math.round(v * 100)}٪` },
    intervalHours: { title: 'فاصله‌ی اجرا', parse: (s) => { const n = Number(s); return n >= 0.5 && n <= 168 ? n : null; }, fmt: (v) => `${v} ساعت` },
  };

  const ask = (key) => {
    const value = FIELDS[key].parse(draft[key]);
    if (value == null) return setMsg({ bad: true, text: `مقدار «${FIELDS[key].title}» نامعتبر است` });
    const fmt = FIELDS[key].fmt || show;
    if (JSON.stringify(value) === JSON.stringify(values[key])) return setMsg({ text: 'تغییری نکرده است' });
    setConfirm({ title: FIELDS[key].title, from: fmt(values[key]), to: fmt(value), run: () => saveSetting(key, value) });
  };
  const askRun = () => setConfirm({ title: 'اجرای دستی همگام‌سازی', text: 'ربات در کمتر از یک دقیقه (با worker فعال) یک اجرای کامل انجام می‌دهد.', run: requestRun });
  const doIt = () => start(async () => {
    const r = await confirm.run();
    setConfirm(null);
    setMsg(r.error ? { bad: true, text: r.error } : { text: 'ذخیره شد' });
  });

  const field = (key, hint, extra) => (
    <div className="field">
      <label htmlFor={key}>{FIELDS[key].title}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {extra?.textarea
          ? <textarea id={key} className="input" style={{ flex: 1 }} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          : <input id={key} className="input tnum" style={{ width: 140 }} dir="ltr" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
        {extra?.unit && <span style={{ alignSelf: 'center' }}>{extra.unit}</span>}
        <button className="btn" type="button" onClick={() => ask(key)}>ذخیره…</button>
      </div>
      <span className="hint">{hint}</span>
    </div>
  );

  const excluded = parseList(draft.excludedCategories) || [];
  return (
    <>
      {msg && <div className={`banner ${msg.bad ? 'bad' : 'warn'}`} style={msg.bad ? undefined : { color: 'var(--ok)', background: 'var(--ok-soft)', borderColor: 'var(--ok)' }}>{msg.text}</div>}
      <div className="grid g2">
        <div className="card">
          <h2>فیلتر محصولات</h2>
          {field('excludedCategories', 'کد دسته‌ها با ویرگول یا فاصله. محصولات این دسته‌ها «مخفی» (غیرقابل‌فروش) ذخیره می‌شوند.', { textarea: true })}
          <div className="chips" style={{ marginTop: -8, marginBottom: 16 }}>
            {excluded.map((c) => <span key={c} className={`chip${label[c] && !label[c].startsWith('#') ? '' : ' unnamed'}`}>{c}: {label[c] || 'نامشخص'}</span>)}
          </div>
          {field('sellableOverrides', 'کد محصولاتی که حتی در دسته‌ی مستثنا قابل‌فروش بمانند.', { textarea: true })}
        </div>
        <div className="card">
          <h2>بررسی قیمت و زمان‌بندی</h2>
          {field('priceJumpLimit', 'اگر قیمت یا قیمت تمام‌شده بیش از این درصد تغییر کند، محصول رد و مقدار قبلی حفظ می‌شود.', { unit: 'درصد' })}
          {field('intervalHours', 'فاصله‌ی اجراهای خودکار worker (۰٫۵ تا ۱۶۸ ساعت).', { unit: 'ساعت' })}
          <div className="field">
            <label>اجرای دستی</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btn-primary" type="button" onClick={askRun} disabled={!!pending}>اجرای دستی…</button>
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
              <div className="diff mono"><div>قبل: <span className="old">{confirm.from}</span></div><div>بعد: <span className="new">{confirm.to}</span></div></div>
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
