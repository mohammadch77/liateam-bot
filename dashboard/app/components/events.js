import { toman, ago, pct, num } from '@/lib/format';

export const KINDS = {
  price: ['تغییر قیمت فروش', 'b-info'],
  cost: ['تغییر قیمت تمام‌شده', 'b-info'],
  out_of_stock: ['ناموجود شد', 'b-bad'],
  back_in_stock: ['دوباره موجود شد', 'b-ok'],
  new: ['محصول جدید', 'b-ok'],
  removed: ['حذف از لیاتیم', 'b-bad'],
  returned: ['برگشت به لیاتیم', 'b-ok'],
  name: ['تغییر نام', 'b-hidden'],
};

function detail(e) {
  if (e.kind === 'price' || e.kind === 'cost') {
    const o = Number(e.old_value), n = Number(e.new_value);
    const d = o ? (n - o) / o : null;
    return (
      <>از <bdi>{toman(o)}</bdi> به <b><bdi>{toman(n)}</bdi></b> تومان
        {d != null && <span className={`tnum ${d > 0 ? 'neg' : 'pos'}`} dir="ltr"> {pct(Math.abs(d))}{d > 0 ? '+' : '−'}</span>}</>
    );
  }
  if (e.kind === 'out_of_stock') return <>موجودی از <bdi>{num(Number(e.old_value))}</bdi> به صفر رسید</>;
  if (e.kind === 'back_in_stock') return <>موجودی جدید: <bdi>{num(Number(e.new_value))}</bdi> عدد</>;
  if (e.kind === 'new') return <>قیمت فروش <bdi>{toman(Number(e.new_value))}</bdi> تومان</>;
  if (e.kind === 'name') return <>نام قبلی: {e.old_value}</>;
  if (e.kind === 'removed') return <>دیگر در فهرست لیاتیم نیست</>;
  return null;
}

export function EventRow({ e, showTime = true }) {
  const [label, cls] = KINDS[e.kind] || [e.kind, 'b-hidden'];
  return (
    <div className="alert-row">
      <span className={`badge ${cls}`}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis">{e.name} <span className="sub tnum">#{num(e.product_id)}</span></div>
        <div className="sub tnum">{detail(e)}</div>
      </div>
      {showTime && <span className="sub tnum row-time">{ago(e.at)}</span>}
    </div>
  );
}
