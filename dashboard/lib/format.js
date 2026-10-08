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
