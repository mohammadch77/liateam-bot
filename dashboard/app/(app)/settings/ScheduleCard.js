'use client';
import { useState, useTransition } from 'react';
import { HELP_FA, TASK_FA } from '@/lib/scheduleRules.mjs';
import { saveIntervals, savePaused, saveWindows } from './actions';

const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const fa = (v) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(v);
const minutesText = (m) => (m == null ? '—' : m % 60 === 0 ? `${fa(m / 60)} ساعت` : `${fa(m)} دقیقه`);
const at = (v) => (v ? new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' }) : '—');
const STATUS_FA = { ok: 'موفق', warning: 'با هشدار', failed: 'ناموفق' };
const TASKS = ['catalog', 'hero', 'details'];
const WINDOWS = [['day', 'روز'], ['evening', 'عصر']];
const WINDOW_LABEL = { day: 'روز', evening: 'عصر', night: 'شب (خواب)' };
const DEFAULT_MINUTES = { day: { catalog: 60, hero: 30, details: 180 }, evening: { catalog: 240, hero: 30, details: 180 } };

/**
 * «زمان‌بندی همگام‌سازی»: windows (day and evening; the night is the rest and always sleeps), the base interval of
 * each task in each window, each task's last and next run (sync_schedule), backoff and pause. The server checks
 * every value with the bot's own rules (minimums from env, windows round the clock) before saving to
 * sync_settings; the worker applies it within 30 s and the bots show the same values.
 */
export default function ScheduleCard({ worker, backoff, runs, minimums }) {
  const sched = worker?.schedule;
  const win = (name) => sched?.windows?.find((w) => w.name === name);
  const times = { day_start: win('day')?.from ?? '07:00', evening_start: win('evening')?.from ?? '19:00', night_start: win('night')?.from ?? '23:00' };
  const minutes = Object.fromEntries(WINDOWS.map(([w]) => [w, Object.fromEntries(TASKS.map((t) => [t, win(w)?.minutes?.[t] ?? DEFAULT_MINUTES[w][t]]))]));
  const paused = !!(worker?.paused ?? sched?.paused);
  const backingOff = backoff?.until && new Date(backoff.until) > new Date();

  const [timeDraft, setTimeDraft] = useState(times);
  const [minDraft, setMinDraft] = useState(() => Object.fromEntries(WINDOWS.flatMap(([w]) => TASKS.map((t) => [`${w}_${t}_minutes`, String(fa(minutes[w][t]))]))));
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, start] = useTransition();

  const askWindows = () => {
    const next = Object.fromEntries(Object.entries(timeDraft).map(([k, v]) => [k, toLatin(v).trim().replace(/^(\d):/, '0$1:')]));
    if (Object.keys(next).every((k) => next[k] === times[k])) return setMsg({ text: 'تغییری نکرده است' });
    setConfirm({
      title: 'پنجره‌های زمانی',
      from: `روز ${times.day_start}–${times.evening_start} · عصر ${times.evening_start}–${times.night_start} · خواب ${times.night_start}–${times.day_start}`,
      to: `روز ${next.day_start}–${next.evening_start} · عصر ${next.evening_start}–${next.night_start} · خواب ${next.night_start}–${next.day_start}`,
      run: () => saveWindows(next),
    });
  };
  const askIntervals = () => {
    const changes = {};
    for (const [w] of WINDOWS) for (const t of TASKS) {
      const key = `${w}_${t}_minutes`;
      const n = Number(toLatin(minDraft[key]).trim());
      if (!Number.isInteger(n)) return setMsg({ bad: true, text: `فاصله‌ی «${TASK_FA[t]}» در ${WINDOW_LABEL[w]} باید یک عدد صحیح (دقیقه) باشد` });
      if (n !== minutes[w][t]) changes[key] = n;
    }
    if (!Object.keys(changes).length) return setMsg({ text: 'تغییری نکرده است' });
    const lines = Object.entries(changes).map(([k, n]) => {
      const [w, t] = k.split('_');
      return `${TASK_FA[t]} در ${WINDOW_LABEL[w]}: ${minutesText(minutes[w][t])} ← ${minutesText(n)}`;
    });
    setConfirm({ title: 'فاصله‌ها', text: lines.join(' · '), run: () => saveIntervals(changes) });
  };
  const doIt = () => start(async () => {
    const r = await confirm.run();
    setConfirm(null);
    setMsg(r.error ? { bad: true, text: r.error } : { text: 'اعمال شد؛ ربات ظرف ۳۰ ثانیه از آن استفاده می‌کند و در ربات‌ها هم همین دیده می‌شود' });
  });

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
            ? <span className="badge b-bad">عقب‌نشینی تا {at(backoff.until)} (مرحله‌ی {fa(backoff.level ?? 1)})</span>
            : paused ? <span className="badge b-warn">موقتاً متوقف</span> : <span className="badge b-ok">فعال</span>}
          <button className="btn btn-sm" type="button"
            onClick={() => setConfirm(paused
              ? { title: 'ادامه‌ی زمان‌بندی', text: 'اجراهای خودکار طبق پنجره‌ها دوباره شروع می‌شوند.', run: () => savePaused(false) }
              : { title: 'توقف موقت زمان‌بندی', text: 'تا «ادامه» هیچ اجرای خودکاری انجام نمی‌شود. «اجرای دستی» همچنان کار می‌کند.', run: () => savePaused(true) })}>
            {paused ? '▶ ادامه…' : '⏸ توقف موقت…'}
          </button>
        </div>
      </div>

      <div className="table-wrap" style={{ margin: '6px 0 12px' }}>
        <table>
          <thead><tr><th>وظیفه</th><th>اجرای قبلی</th><th>اجرای بعدی</th></tr></thead>
          <tbody>
            {TASKS.map((t) => (
              <tr key={t}>
                <td>{TASK_FA[t]}</td>
                <td className="tnum">{at(runs?.[t]?.last_run_at)}{runs?.[t]?.last_status ? ` · ${STATUS_FA[runs[t].last_status] ?? runs[t].last_status}` : ''}</td>
                <td className="tnum">{at(runs?.[t]?.next_run_at ?? worker?.next_run_at?.[t])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: '8px 0' }}>پنجره‌ها</h3>
      <div className="sub" style={{ marginBottom: 8 }}>شب = بقیه‌ی ساعت‌ها؛ همیشه خواب است و حذف نمی‌شود. پنجره‌ها به ترتیب روز ← عصر ← شب، بدون هم‌پوشانی و بدون فاصله.</div>
      <div className="chip-add" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <span>روز از</span>
        <input className="input tnum" dir="ltr" style={{ width: 80 }} aria-label="شروع روز" value={timeDraft.day_start} onChange={(e) => setTimeDraft({ ...timeDraft, day_start: e.target.value })} />
        <span>تا</span>
        <input className="input tnum" dir="ltr" style={{ width: 80 }} aria-label="پایان روز / شروع عصر" value={timeDraft.evening_start} onChange={(e) => setTimeDraft({ ...timeDraft, evening_start: e.target.value })} />
        <span>· عصر تا</span>
        <input className="input tnum" dir="ltr" style={{ width: 80 }} aria-label="پایان عصر / شروع شب" value={timeDraft.night_start} onChange={(e) => setTimeDraft({ ...timeDraft, night_start: e.target.value })} />
        <span className="sub">· شب از {timeDraft.night_start} تا {timeDraft.day_start} (خواب)</span>
        <button className="btn btn-sm" type="button" onClick={askWindows}>اعمال…</button>
      </div>

      <h3 style={{ margin: '14px 0 8px' }}>فاصله‌ی پایه (دقیقه)</h3>
      <div className="banner warn" style={{ marginBottom: 8 }}>{HELP_FA}</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>وظیفه</th>{WINDOWS.map(([w, l]) => <th key={w}>{l}</th>)}<th>حداقل</th></tr></thead>
          <tbody>
            {TASKS.map((t) => (
              <tr key={t}>
                <td>{TASK_FA[t]}</td>
                {WINDOWS.map(([w, l]) => (
                  <td key={w}>
                    <input className="input tnum" dir="ltr" style={{ width: 90 }} aria-label={`${TASK_FA[t]} در ${l} (دقیقه)`}
                      value={minDraft[`${w}_${t}_minutes`]} onChange={(e) => setMinDraft({ ...minDraft, [`${w}_${t}_minutes`]: e.target.value })} />
                    <div className="sub">فعلاً {minutesText(minutes[w][t])}</div>
                  </td>
                ))}
                <td className="sub tnum">{minimums?.[t] != null ? `${fa(minimums[t])} دقیقه` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}><button className="btn btn-sm" type="button" onClick={askIntervals}>اعمال فاصله‌ها…</button></div>

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
