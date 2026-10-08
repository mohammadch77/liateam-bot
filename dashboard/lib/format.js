// Display helpers. Amounts are RIAL integers; numbers render with Persian digits.
const nf = new Intl.NumberFormat('fa-IR');
export const num = (v) => (v == null ? '—' : nf.format(v));
export const rial = (v) => (v == null ? '—' : nf.format(Math.round(v)));
export const pct = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(v * 100)}٪`);
export const dateTime = (v) => (v ? new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function ago(v, now = Date.now()) {
  if (!v) return '—';
  const s = Math.round((now - new Date(v).getTime()) / 1000);
  const fut = s < 0;
  const a = Math.abs(s);
  const t = a < 60 ? 'کمتر از یک دقیقه' : a < 3600 ? `${num(Math.round(a / 60))} دقیقه` : a < 86400 ? `${num(Math.round(a / 3600))} ساعت` : `${num(Math.round(a / 86400))} روز`;
  return fut ? `${t} دیگر` : `${t} پیش`;
}

export const duration = (ms) => (ms == null ? '—' : ms < 60000 ? `${num(Math.round(ms / 1000))} ثانیه` : `${num(Math.round(ms / 6000) / 10)} دقیقه`);

// The supplier reports RIAL; the UI shows Toman (÷10), as in the approved mockup.
export const toman = (rialValue) => (rialValue == null ? '—' : nf.format(Math.round(rialValue / 10)));
/** Large Toman amounts in words: ۲٫۸ میلیارد تومان */
export function tomanShort(rialValue) {
  if (rialValue == null) return '—';
  const t = rialValue / 10;
  const f = (v) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(v);
  if (Math.abs(t) >= 1e9) return `${f(t / 1e9)} میلیارد تومان`;
  if (Math.abs(t) >= 1e6) return `${f(t / 1e6)} میلیون تومان`;
  return `${nf.format(Math.round(t))} تومان`;
}
/** Time until `v` as hh:mm (e.g. ۰۳:۱۲), or null if already past. */
export function countdown(v, now = Date.now()) {
  const m = Math.round((new Date(v).getTime() - now) / 60000);
  if (!(m > 0)) return null;
  const p = (x) => String(x).padStart(2, '0');
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}
export const shortDate = (v) => (v ? new Date(v).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long' }) : '—');
export const runStamp = (v) => {
  const d = new Date(v);
  const date = d.toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = d.toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} — ${time}`;
};
