'use client';
import { useState, useTransition } from 'react';
import { saveSetting, createInvite, setChatRole, removeChat } from './actions';

const PLATFORMS = {
  bale: { label: 'بله', link: (u) => `https://ble.ir/${u}` },
  telegram: { label: 'تلگرام', link: (u) => `https://t.me/${u}` },
};
const ROLE = { admin: 'مدیر', viewer: 'بیننده' };
const GROUP = { price: 'قیمت', stock: 'موجودی', catalog: 'محصول جدید/حذف', errors: 'خطاها', daily: 'گزارش روزانه' };
const fa = (v) => new Intl.NumberFormat('fa-IR').format(v);
const ago = (v) => {
  if (!v) return 'هنوز پیامی نداده';
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  return m < 1 ? 'همین الان' : m < 60 ? `${fa(m)} دقیقه پیش` : m < 1440 ? `${fa(Math.round(m / 60))} ساعت پیش` : `${fa(Math.round(m / 1440))} روز پیش`;
};

function platformState(p, st, on) {
  if (!st?.configured) return ['b-hidden', 'توکن روی سرور تنظیم نشده'];
  if (!on) return ['b-hidden', 'خاموش'];
  if (!st.heartbeat || Date.now() - new Date(st.heartbeat).getTime() > 180_000) return ['b-warn', 'سرویس ربات روشن نیست'];
  if (!st.ok) return ['b-bad', 'اتصال برقرار نیست'];
  return ['b-ok', `متصل${st.username ? ` · @${st.username}` : ''}`];
}

export default function MessengerCard({ status, enabled, chats }) {
  const [confirm, setConfirm] = useState(null);
  const [invite, setInvite] = useState(null);
  const [role, setRole] = useState('viewer');
  const [msg, setMsg] = useState(null);
  const [busy, start] = useTransition();

  const doIt = () => start(async () => {
    const r = await confirm.run();
    setConfirm(null);
    setMsg(r?.error ? { bad: true, text: r.error } : { text: confirm.done || 'اعمال شد و در گزارش ثبت شد' });
  });
  const newInvite = () => start(async () => {
    const r = await createInvite(role);
    if (r.error) setMsg({ bad: true, text: r.error });
    else setInvite({ ...r, role });
  });
  const anyOn = Object.keys(PLATFORMS).some((p) => enabled[p]);

  return (
    <div className="card section">
      <div className="card-head"><h2>ربات‌های تلگرام و بله</h2></div>
      <div className="sub" style={{ marginBottom: 6 }}>اعلان تغییرات و هشدارها، جست‌وجوی محصول و وضعیت برای کارفرما. ربات‌ها فقط از اطلاعات ذخیره‌شده جواب می‌دهند و درخواستی به لیاتیم نمی‌فرستند.</div>
      {msg && <div className={`banner ${msg.bad ? 'bad' : 'ok'}`}>{msg.text}</div>}

      {Object.entries(PLATFORMS).map(([p, meta]) => {
        const st = status[p];
        const [cls, label] = platformState(p, st, enabled[p]);
        return (
          <div className="kv" key={p}>
            <div className="k">ربات {meta.label}
              <small>{st?.error && enabled[p] ? `آخرین خطا: ${st.error}` : p === 'telegram' ? 'روی سرور ایران به واسطه‌ی Cloudflare Worker نیاز دارد' : 'روی سرور ایران مستقیم کار می‌کند'}</small>
            </div>
            <div className="chip-add" style={{ alignItems: 'center' }}>
              <span className={`badge ${cls}`}>{label}</span>
              {st?.username && enabled[p] && <a className="btn btn-sm" href={meta.link(st.username)} target="_blank" rel="noreferrer">باز کردن</a>}
              <button type="button" className={`btn btn-sm${enabled[p] ? '' : ' btn-primary'}`} disabled={!st?.configured}
                onClick={() => setConfirm({
                  title: `${enabled[p] ? 'خاموش' : 'روشن'} کردن ربات ${meta.label}`,
                  text: enabled[p] ? 'ربات دیگر پیامی نمی‌فرستد و به پیام‌ها جواب نمی‌دهد. کاربران متصل حذف نمی‌شوند.' : 'ربات ظرف حدود ۳۰ ثانیه شروع به کار می‌کند.',
                  run: () => saveSetting(`${p}Enabled`, !enabled[p]),
                })}>
                {enabled[p] ? 'خاموش کردن' : 'روشن کردن'}
              </button>
            </div>
          </div>
        );
      })}

      <div className="kv" style={{ display: 'block' }}>
        <div className="k" style={{ marginBottom: 8 }}>افزودن کاربر<small>یک کد یک‌بارمصرف ۳۰ دقیقه‌ای بسازید؛ کاربر آن را برای ربات می‌فرستد و وصل می‌شود.</small></div>
        <div className="chip-add" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="نقش">
            <option value="viewer">بیننده (قیمت فروش، موجودی، تغییرات)</option>
            <option value="admin">مدیر (+ قیمت تمام‌شده، سود، اجرای دستی)</option>
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={newInvite} disabled={busy || !anyOn}>ساخت کد دعوت</button>
          {!anyOn && <span className="sub">اول یکی از ربات‌ها را روشن کنید.</span>}
        </div>
      </div>

      <div className="kv" style={{ display: 'block' }}>
        <div className="k" style={{ marginBottom: 8 }}>کاربران متصل ({fa(chats.length)})</div>
        {chats.length === 0 ? <div className="empty">هنوز کسی وصل نشده است</div> : (
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr><th>نام</th><th>پیام‌رسان</th><th>نقش</th><th>اعلان‌ها</th><th>آخرین فعالیت</th><th></th></tr></thead>
              <tbody>
                {chats.map((c) => (
                  <tr key={c.id}>
                    <td>{c.display_name}</td>
                    <td>{PLATFORMS[c.platform]?.label ?? c.platform}</td>
                    <td>
                      <select className="select" style={{ padding: '3px 8px' }} value={c.role} aria-label="نقش"
                        onChange={(e) => setConfirm({ title: `تغییر نقش ${c.display_name}`, from: ROLE[c.role], to: ROLE[e.target.value], run: () => setChatRole(c.id, e.target.value) })}>
                        {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td className="sub">{c.notify ? c.kinds.map((k) => GROUP[k] || k).join('، ') || 'هیچ' : 'خاموش'}</td>
                    <td className="sub tnum">{ago(c.last_seen_at)}</td>
                    <td><button type="button" className="btn btn-sm" onClick={() => setConfirm({
                      title: `حذف ${c.display_name}`, text: 'دسترسی این کاربر به ربات قطع می‌شود و دیگر اعلانی دریافت نمی‌کند. برای اتصال دوباره کد دعوت جدید لازم است.',
                      run: () => removeChat(c.id), done: 'کاربر حذف شد' })}>حذف</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {invite && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="invite-title">
          <div className="modal" style={{ textAlign: 'center' }}>
            <h2 id="invite-title">کد دعوت ({ROLE[invite.role]})</h2>
            <div className="invite-code tnum" dir="ltr">{invite.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
            <p className="sub">تا ساعت {new Date(invite.expiresAt).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' })} معتبر است و فقط یک بار کار می‌کند.</p>
            <ol style={{ textAlign: 'start', lineHeight: 2 }}>
              {Object.entries(PLATFORMS).filter(([p]) => enabled[p] && status[p]?.username).map(([p, meta]) => (
                <li key={p}>در {meta.label}: <a href={meta.link(status[p].username)} target="_blank" rel="noreferrer" dir="ltr">@{status[p].username}</a> را باز کنید و «شروع» را بزنید.</li>
              ))}
              <li>همین کد ۶ رقمی را برای ربات بفرستید.</li>
            </ol>
            <button className="btn btn-primary" type="button" onClick={() => setInvite(null)}>بستن</button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="m-confirm-title">
          <div className="modal">
            <h2 id="m-confirm-title">تأیید: {confirm.title}</h2>
            {confirm.text ? <p>{confirm.text}</p> : (
              <div className="diff"><div>قبل: <span className="old">{confirm.from}</span></div><div>بعد: <span className="new">{confirm.to}</span></div></div>
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
