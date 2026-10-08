'use client';
import { useMemo, useState } from 'react';
import { COLUMNS, STATUS, applyFilters, statusOf, profit, margin, isLow } from '@/lib/products';
import { num, toman, tomanShort, pct } from '@/lib/format';

// Code is shown under the name instead of in its own column (as in the mockup); exports keep it.
const UI_COLUMNS = COLUMNS.filter((c) => c.key !== 'id');

const STATUS_CLS = { in: 'b-ok', out: 'b-bad', hidden: 'b-hidden' };

export default function ProductsTable({ products, categories }) {
  const [f, setF] = useState({ q: '', cat: '', status: '', sort: 'name', dir: 'asc' });
  const rows = useMemo(() => applyFilters(products, f), [products, f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const sortBy = (key) => setF({ ...f, sort: key, dir: f.sort === key && f.dir === 'asc' ? 'desc' : 'asc' });
  const exportUrl = (fmt) => `/api/export?${new URLSearchParams({ ...f, fmt })}`;
  // Summary of the current (filtered) list.
  const sum = useMemo(() => {
    const c = { sellable: 0, out: 0, low: 0, value: 0, best: null };
    for (const p of rows) {
      const st = statusOf(p);
      if (st !== 'hidden') c.sellable++;
      if (st === 'out') c.out++;
      if (isLow(p)) c.low++;
      if (st === 'in') c.value += (p.cost_price ?? 0) * p.stock;
      if (st !== 'hidden' && margin(p) != null && (!c.best || margin(p) > margin(c.best))) c.best = p;
    }
    return c;
  }, [rows]);

  return (
    <>
      <div className="page-head">
        <div><h1>محصولات</h1>
          <div className="sub tnum">{num(products.length)} محصول در کاتالوگ تأمین‌کننده</div>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <a className="btn" href={exportUrl('xlsx')}>خروجی Excel</a>
          <a className="btn" href={exportUrl('csv')}>خروجی CSV</a>
        </div>
      </div>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card"><div className="stat-label">نمایش‌داده‌شده</div><div className="stat-value">{num(sum.sellable)}</div><div className="stat-foot">محصول قابل‌فروش</div></div>
        <div className="card"><div className="stat-label">ارزش موجودی (فیلتر)</div><div className="stat-value">{tomanShort(sum.value)}</div><div className="stat-foot">مجموع لیست فعلی</div></div>
        <div className="card"><div className="stat-label">ناموجود</div><div className="stat-value" style={{ color: sum.out ? 'var(--bad)' : undefined }}>{num(sum.out)}</div><div className="stat-foot">موجودی صفر · {num(sum.low)} رو به اتمام</div></div>
        <div className="card"><div className="stat-label">پرسودترین</div><div className="stat-value">{sum.best ? pct(margin(sum.best), 0) : '—'}</div><div className="stat-foot ellipsis">{sum.best?.name ?? '—'}</div></div>
      </div>
      <div className="toolbar">
        <input className="input" style={{ flex: '1 1 240px' }} placeholder="جست‌وجوی نام یا کد…" value={f.q} onChange={set('q')} aria-label="جست‌وجو" />
        <select className="select" value={f.cat} onChange={set('cat')} aria-label="دسته">
          <option value="">همه‌ی دسته‌ها</option>
          {categories.map((c) => <option key={c.code} value={c.code}>{c.label} ({num(c.products)})</option>)}
        </select>
        <select className="select" value={f.status} onChange={set('status')} aria-label="وضعیت">
          <option value="">همه‌ی وضعیت‌ها</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="sub tnum">{num(rows.length)} نتیجه</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {UI_COLUMNS.map((c) => (
                <th key={c.key} className={`sortable${c.num ? ' num' : ''}`} onClick={() => sortBy(c.key)}
                    aria-sort={f.sort === c.key ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {c.label.replace(/ \(تومان\)/, '')} {f.sort === c.key ? '' : '↕'}{f.sort === c.key ? (f.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={UI_COLUMNS.length} className="empty">محصولی با این فیلترها نیست</td></tr>}
            {rows.map((p) => {
              const st = statusOf(p);
              const pr = profit(p);
              const low = isLow(p);
              return (
                <tr key={p.id} className={st === 'out' ? 'row-out' : st === 'hidden' ? 'row-hidden' : ''}>
                  <td className="wrap">{p.name}<div className="sub tnum">کد {num(p.id)}</div></td>
                  <td className="num">{toman(p.price)}</td>
                  <td className="num">{toman(p.cost_price)}</td>
                  <td className={`num ${pr < 0 ? 'neg' : ''}`}>{toman(pr)}<div className="sub">{pct(margin(p), 0)}</div></td>
                  <td className={`num ${st === 'out' ? 'stock-out' : low ? 'stock-low' : ''}`} title={low ? 'موجودی کم' : undefined}>
                    {num(p.stock)}{low && ' ⚠'}
                  </td>
                  <td><div className="chips">{p.category_names.map((n, i) => <span key={i} className={`chip${n.startsWith('#') ? ' unnamed' : ''}`}>{n}</span>)}</div></td>
                  <td><span className={`badge ${STATUS_CLS[st]}`}>{STATUS[st]}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="foot-note">قیمت‌ها به تومان · قیمت تمام‌شده و سود فقط برای شما نمایش داده می‌شود · موجودی زیر حد با ⚠ و ناموجود با ردیف قرمز مشخص است</div>
    </>
  );
}
