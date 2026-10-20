'use client';
import { useState, useTransition } from 'react';
import { saveIntervals } from '../settings/actions';
import { HELP_FA } from '@/lib/scheduleRules.mjs';

const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const fa = (v) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(v);

/** How often the banners are checked (sync_settings hero_minutes — the same value as in settings and the bots). */
export default function BannerInterval({ minutes }) {
  const [value, setValue] = useState(String(fa(minutes)));
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, start] = useTransition();
  const ask = () => {
    const n = Math.round(Number(toLatin(value).trim()));
    if (!Number.isInteger(n)) return setMsg({ bad: true, text: 'یک عدد صحیح (دقیقه) بنویسید' });
    if (n === minutes) return setMsg({ text: 'تغییری نکرده است' });
    setConfirm(n);
  };
  const doIt = () => start(async () => {
    const r = await saveIntervals({ day_hero_minutes: confirm, evening_hero_minutes: confirm });
    setConfirm(null);
    setMsg(r.error ? { bad: true, text: r.error } : { text: 'اعمال شد؛ در تنظیمات و ربات‌ها هم همین دیده می‌شود' });
  });
  return (
    <div className="card section">
      <div className="kv" style={{ borderBottom: 0 }}>
        <div className="k">فاصله‌ی بررسی بنرها<small>روز و عصر، هر چند دقیقه (±۲۰٪ تصادفی) · شب‌ها بررسی نمی‌شود · {HELP_FA} · جداگانه برای روز و عصر: تنظیمات ← زمان‌بندی</small></div>
        <div className="chip-add" style={{ alignItems: 'center' }}>
          <input className="input tnum" dir="ltr" value={value} aria-label="فاصله‌ی بررسی بنرها" onChange={(e) => setValue(e.target.value)} />
          <span>دقیقه</span>
          <button className="btn btn-sm" type="button" onClick={ask}>اعمال…</button>
        </div>
      </div>
      {msg && <div className={`banner ${msg.bad ? 'bad' : 'ok'}`}>{msg.text}</div>}
      {confirm != null && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="banner-confirm-title">
          <div className="modal">
            <h2 id="banner-confirm-title">تأیید: فاصله‌ی بررسی بنرها</h2>
            <div className="diff tnum"><div>قبل: <span className="old">هر {fa(minutes)} دقیقه</span></div><div>بعد: <span className="new">هر {fa(confirm)} دقیقه</span></div></div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setConfirm(null)} disabled={busy}>انصراف</button>
              <button className="btn btn-primary" type="button" onClick={doIt} disabled={busy}>{busy ? '…' : 'تأیید و اعمال'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
