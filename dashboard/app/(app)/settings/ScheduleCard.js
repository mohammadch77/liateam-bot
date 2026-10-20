'use client';
import { useState, useTransition } from 'react';
import { saveSchedule } from './actions';

const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const fa = (v) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2, useGrouping: false }).format(v);
const minutesText = (m) => (m == null ? '—' : m % 60 === 0 ? `${fa(m / 60)} ساعت` : `${fa(m)} دقیقه`);
const at = (v) => (v ? new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' }) : '—');

// The intervals people change; prices/stock in hours (as before), banners in minutes.
const FIELDS = [
  { key: 'day_catalog_minutes', label: 'قیمت و موجودی — روز', hint: 'هر چند ساعت در پنجره‌ی روز', unit: 'ساعت', toMinutes: (n) => Math.round(n * 60), fromMinutes: (m) => m / 60 },
  { key: 'evening_catalog_minutes', label: 'قیمت و موجودی — عصر', hint: 'هر چند ساعت در پنجره‌ی عصر', unit: 'ساعت', toMinutes: (n) => Math.round(n * 60), fromMinutes: (m) => m / 60 },
  { key: 'hero_minutes', label: 'بنرهای صفحه‌ی اصلی', hint: 'هر چند دقیقه، روز و عصر', unit: 'دقیقه', toMinutes: (n) => Math.round(n), fromMinutes: (m) => m },
  { key: 'details_minutes', label: 'محتوای سنگین', hint: 'توضیحات، عکس، ویدیو، پرسش‌ها، نظرات — هر چند ساعت', unit: 'ساعت', toMinutes: (n) => Math.round(n * 60), fromMinutes: (m) => m / 60 },
];
const TASK_LABEL = { catalog: 'قیمت و موجودی', hero: 'بنرها', details: 'محتوای سنگین' };
const WINDOW_LABEL = { day: 'روز', evening: 'عصر', night: 'شب (خواب)' };

/**
 * «زمان‌بندی همگام‌سازی»: the schedule in effect (as the bot reports it), each task's next run, and the settings —
 * intervals, window start times, pause. Every change asks for confirmation and is written to sync_settings + the
 * audit log; the worker applies it within 30 s and the bots show the same values.
 */
export default function ScheduleCard({ worker, backoff }) {
  const sched = worker?.schedule;
  const win = (name) => sched?.windows?.find((w) => w.name === name);
  const current = {
    day_catalog_minutes: win('day')?.minutes?.catalog ?? 60,
    evening_catalog_minutes: win('evening')?.minutes?.catalog ?? 240,
    hero_minutes: win('day')?.minutes?.hero ?? 30,
    details_minutes: win('day')?.minutes?.details ?? 180,
    day_start: win('day')?.from ?? '07:00',
    evening_start: win('evening')?.from ?? '19:00',
    night_start: win('night')?.from ?? '23:00',
  };
  const paused = !!(worker?.paused ?? sched?.paused);
  const [draft, setDraft] = useState(() => ({
    ...Object.fromEntries(FIELDS.map((f) => [f.key, String(fa(f.fromMinutes(current[f.key])))])),
    day_start: current.day_start, evening_start: current.evening_start, night_start: current.night_start,
  }));
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, start] = useTransition();

  const askInterval = (f) => {
    const n = Number(toLatin(draft[f.key]).trim());
    const minutes = Number.isFinite(n) ? f.toMinutes(n) : NaN;
    if (!(minutes >= 10 && minutes <= 1440)) return setMsg({ bad: true, text: `«${f.label}» باید بین ۱۰ دقیقه و ۲۴ ساعت باشد` });
    if (minutes === current[f.key]) return setMsg({ text: 'تغییری نکرده است' });
    setConfirm({ title: f.label, from: `هر ${minutesText(current[f.key])}`, to: `هر ${minutesText(minutes)}`, run: () => saveSchedule(f.key, minutes) });
  };
  const askTime = (key, label) => {
    const v = toLatin(draft[key]).trim().replace(/^(\d):/, '0$1:');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return setMsg({ bad: true, text: `«${label}» را به شکل ۰۷:۰۰ بنویسید` });
    const others = ['day_start', 'evening_start', 'night_start'].filter((k) => k !== key).map((k) => current[k]);
    if (others.includes(v)) return setMsg({ bad: true, text: 'شروع دو پنجره نمی‌تواند یکی باشد' });
    if (v === current[key]) return setMsg({ text: 'تغییری نکرده است' });
    setConfirm({ title: label, from: current[key], to: v, run: () => saveSchedule(key, v) });
  };
  const doIt = () => start(async () => {
    const r = await confirm.run();
    setConfirm(null);
    setMsg(r.error ? { bad: true, text: r.error } : { text: 'اعمال شد؛ ربات ظرف ۳۰ ثانیه از آن استفاده می‌کند و در ربات‌ها هم همین دیده می‌شود' });
  });

  const backingOff = backoff?.until && new Date(backoff.until) > new Date();
  return (
    <div className="card section">
      <h2>زمان‌بندی همگام‌سازی</h2>
      <div className="sub" style={{ marginTop: -6, marginBottom: 10 }}>
        به وقت تهران · هر فاصله ±{fa(Math.round((sched?.jitter ?? 0.2) * 100))}٪ تصادفی و هیچ اجرایی سر ساعت گرد نیست · شب‌ها هیچ درخواستی به لیاتیم نمی‌رود · همین تنظیمات در ربات بله و تلگرام («⏱ زمان‌بندی») هم دیده و تغییر داده می‌شود
      </div>
      {msg && <div className={`banner ${msg.bad ? 'bad' : 'ok'}`}>{msg.text}</div>}

      <div className="kv">
        <div className="k">وضعیت<small>پنجره‌ی فعلی: {WINDOW_LABEL[worker?.window] ?? '—'}</small></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {backingOff
            ? <span className="badge b-bad">عقب‌نشینی تا {at(backoff.until)}</span>
            : paused ? <span className="badge b-warn">موقتاً متوقف</span> : <span className="badge b-ok">فعال</span>}
          <button className="btn btn-sm" type="button"
            onClick={() => setConfirm(paused
              ? { title: 'ادامه‌ی زمان‌بندی', text: 'اجراهای خودکار طبق پنجره‌ها دوباره شروع می‌شوند.', run: () => saveSchedule('paused', false) }
              : { title: 'توقف موقت زمان‌بندی', text: 'تا «ادامه» هیچ اجرای خودکاری انجام نمی‌شود. «اجرای دستی» همچنان کار می‌کند.', run: () => saveSchedule('paused', true) })}>
            {paused ? '▶ ادامه…' : '⏸ توقف موقت…'}
          </button>
        </div>
      </div>
      <div className="kv">
        <div className="k">اجرای بعدی</div>
        <div className="sub tnum" style={{ textAlign: 'left' }}>
          {Object.entries(TASK_LABEL).map(([t, l]) => <div key={t}>{l}: {at(worker?.next_run_at?.[t])}</div>)}
        </div>
      </div>

      {FIELDS.map((f) => (
        <div className="kv" key={f.key}>
          <div className="k">{f.label}<small>{f.hint} · فعلاً هر {minutesText(current[f.key])}</small></div>
          <div className="chip-add" style={{ alignItems: 'center' }}>
            <input className="input tnum" dir="ltr" value={draft[f.key]} aria-label={f.label}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            <span>{f.unit}</span>
            <button className="btn btn-sm" type="button" onClick={() => askInterval(f)}>اعمال…</button>
          </div>
        </div>
      ))}

      {[['day_start', 'شروع روز'], ['evening_start', 'شروع عصر'], ['night_start', 'شروع خواب شبانه']].map(([key, label]) => (
        <div className="kv" key={key}>
          <div className="k">{label}<small>{key === 'night_start' ? `از این ساعت تا شروع روز، ربات خواب است` : 'ساعت:دقیقه'}</small></div>
          <div className="chip-add" style={{ alignItems: 'center' }}>
            <input className="input tnum" dir="ltr" value={draft[key]} aria-label={label} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
            <button className="btn btn-sm" type="button" onClick={() => askTime(key, label)}>اعمال…</button>
          </div>
        </div>
      ))}

      {confirm && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="schedule-confirm-title">
          <div className="modal">
            <h2 id="schedule-confirm-title">تأیید: {confirm.title}</h2>
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
    </div>
  );
}
