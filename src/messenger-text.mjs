// Persian text for the messenger bots. Plain text + emoji (works the same on Telegram and Bale).
const nf = new Intl.NumberFormat('fa-IR');
export const num = (v) => (v == null ? '—' : nf.format(v));
export const toman = (rial) => (rial == null ? '—' : nf.format(Math.round(Number(rial) / 10)));
export const pct = (v) => `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(Math.abs(v) * 100)}٪`;
export const time = (v) => new Date(v).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false });
export const date = (v) => new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' });
export function ago(v, now = Date.now()) {
  if (!v) return '—';
  const s = Math.round((now - new Date(v).getTime()) / 1000);
  const a = Math.abs(s);
  const t = a < 60 ? 'چند لحظه' : a < 3600 ? `${num(Math.round(a / 60))} دقیقه` : a < 86400 ? `${num(Math.round(a / 3600))} ساعت` : `${num(Math.round(a / 86400))} روز`;
  return s < 0 ? `${t} دیگر` : `${t} پیش`;
}
export const LINE = '━━━━━━━━━━━━';

// Notification groups a person can switch on/off, and the event kinds in each.
export const GROUPS = {
  price: { label: 'تغییر قیمت', icon: '💰', kinds: ['price', 'cost'] },
  stock: { label: 'موجودی (ناموجود / موجود شد)', icon: '📦', kinds: ['out_of_stock', 'back_in_stock'] },
  catalog: { label: 'محصول جدید یا حذف‌شده', icon: '🆕', kinds: ['new', 'removed', 'returned', 'name'] },
  errors: { label: 'خطاها و هشدارهای غیرعادی', icon: '🚨', kinds: [] },
};
export const KIND = {
  price: { icon: '💰', label: 'تغییر قیمت فروش' },
  cost: { icon: '🏷', label: 'تغییر قیمت تمام‌شده', admin: true },
  out_of_stock: { icon: '🔴', label: 'ناموجود شد' },
  back_in_stock: { icon: '🟢', label: 'دوباره موجود شد' },
  new: { icon: '🆕', label: 'محصول جدید' },
  removed: { icon: '🗑', label: 'حذف از لیاتیم' },
  returned: { icon: '↩️', label: 'برگشت به لیاتیم' },
  name: { icon: '✏️', label: 'تغییر نام' },
};
export const UNUSUAL_PRICE = 0.15; // a price move this large is flagged as unusual

export function eventLine(e) {
  if (e.kind === 'price' || e.kind === 'cost') {
    const o = Number(e.old_value), n = Number(e.new_value);
    const d = o ? (n - o) / o : 0;
    const flag = Math.abs(d) >= UNUSUAL_PRICE ? ' ⚠️ غیرعادی' : '';
    return `• ${e.name}\n   از ${toman(o)} به ${toman(n)} تومان (${d >= 0 ? '+' : '−'}${pct(d)})${flag}`;
  }
  if (e.kind === 'out_of_stock') return `• ${e.name} (قبلاً ${num(Number(e.old_value))} عدد)`;
  if (e.kind === 'back_in_stock') return `• ${e.name} — ${num(Number(e.new_value))} عدد`;
  if (e.kind === 'new') return `• ${e.name} — ${toman(e.new_value)} تومان`;
  if (e.kind === 'name') return `• ${e.old_value}\n   ← ${e.name}`;
  return `• ${e.name}`;
}

/** Groups events by kind into sections, max `perKind` lines each. */
export function eventSections(events, perKind = 8) {
  const out = [];
  for (const [kind, meta] of Object.entries(KIND)) {
    const list = events.filter((e) => e.kind === kind);
    if (!list.length) continue;
    out.push(`\n${meta.icon} ${meta.label} (${num(list.length)})`);
    for (const e of list.slice(0, perKind)) out.push(eventLine(e));
    if (list.length > perKind) out.push(`   … و ${num(list.length - perKind)} مورد دیگر`);
  }
  return out.join('\n');
}

export const FAILURE = {
  auth: 'لاگین لیاتیم ناموفق بود (رمز در .env سرور را بررسی کنید)',
  structure: 'ساختار صفحه‌های لیاتیم تغییر کرده است',
  coverage: 'همه‌ی محصولات دریافت نشد',
  database: 'دیتابیس در دسترس نبود',
  error: 'خطای پیش‌بینی‌نشده',
};

export const clip = (s, max = 3900) => (s.length > max ? s.slice(0, max - 20) + '\n…' : s);
