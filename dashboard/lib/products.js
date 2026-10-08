// Product status, filtering and sorting: shared by the table (client) and the export route (server).
export const STATUS = { in: 'موجود', out: 'ناموجود', hidden: 'مخفی' };
export const LOW_STOCK = Number(process.env.NEXT_PUBLIC_LOW_STOCK || 10);

export function statusOf(p) {
  if (!p.is_sellable) return 'hidden';
  if (p.stock <= 0 || p.is_available === false) return 'out';
  return 'in';
}

export const profit = (p) => (p.price == null || p.cost_price == null ? null : p.price - p.cost_price);

export const COLUMNS = [
  { key: 'name', label: 'نام', get: (p) => p.name },
  { key: 'id', label: 'کد', get: (p) => p.id, num: true },
  { key: 'price', label: 'قیمت فروش (ریال)', get: (p) => p.price, num: true },
  { key: 'cost_price', label: 'قیمت تمام‌شده (ریال)', get: (p) => p.cost_price, num: true },
  { key: 'profit', label: 'سود (ریال)', get: profit, num: true },
  { key: 'stock', label: 'موجودی', get: (p) => p.stock, num: true },
  { key: 'category', label: 'دسته', get: (p) => p.category_names.join('، ') },
  { key: 'status', label: 'وضعیت', get: (p) => STATUS[statusOf(p)] },
];

const norm = (s) => String(s).replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).toLowerCase();

/** f = { q, cat, status, sort, dir } (all optional). Returns a new array. */
export function applyFilters(rows, f) {
  const q = f.q ? norm(f.q.trim()) : '';
  const cat = f.cat ? Number(f.cat) : null;
  let out = rows.filter(
    (p) =>
      (!q || norm(p.name).includes(q) || String(p.id).includes(q)) &&
      (cat == null || p.category.includes(cat)) &&
      (!f.status || statusOf(p) === f.status),
  );
  const col = COLUMNS.find((c) => c.key === f.sort);
  if (col) {
    const sign = f.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (col.num ? x - y : String(x).localeCompare(String(y), 'fa')) * sign;
    });
  }
  return out;
}
