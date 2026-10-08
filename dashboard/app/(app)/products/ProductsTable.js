'use client';
import { useMemo, useState } from 'react';
import { COLUMNS, STATUS, LOW_STOCK, applyFilters, statusOf, profit } from '@/lib/products';
import { num, rial } from '@/lib/format';

const STATUS_CLS = { in: 'b-ok', out: 'b-bad', hidden: 'b-hidden' };

export default function ProductsTable({ products, categories }) {
  const [f, setF] = useState({ q: '', cat: '', status: '', sort: 'name', dir: 'asc' });
  const rows = useMemo(() => applyFilters(products, f), [products, f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const sortBy = (key) => setF({ ...f, sort: key, dir: f.sort === key && f.dir === 'asc' ? 'desc' : 'asc' });
  const exportUrl = (fmt) => `/api/export?${new URLSearchParams({ ...f, fmt })}`;
  const counts = useMemo(() => {
    const c = { in: 0, out: 0, hidden: 0, low: 0 };
    for (const p of products) { c[statusOf(p)]++; if (statusOf(p) === 'in' && p.stock <= LOW_STOCK) c.low++; }
    return c;
  }, [products]);

  return (
    <>
      <div className="page-head">
        <div><h1>محصولات</h1>
          <div className="sub tnum">{num(products.length)} محصول · {num(counts.in)} موجود · {num(counts.out)} ناموجود · {num(counts.hidden)} مخفی · {num(counts.low)} رو به اتمام</div>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <a className="btn" href={exportUrl('xlsx')}>خروجی Excel</a>
          <a className="btn" href={exportUrl('csv')}>خروجی CSV</a>
        </div>
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
              {COLUMNS.map((c) => (
                <th key={c.key} className={`sortable${c.num ? ' num' : ''}`} onClick={() => sortBy(c.key)}
                    aria-sort={f.sort === c.key ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {c.label} {f.sort === c.key ? (f.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={COLUMNS.length} className="empty">محصولی با این فیلترها نیست</td></tr>}
            {rows.map((p) => {
              const st = statusOf(p);
              const pr = profit(p);
              const low = st === 'in' && p.stock <= LOW_STOCK;
              return (
                <tr key={p.id} className={st === 'out' ? 'row-out' : st === 'hidden' ? 'row-hidden' : ''}>
                  <td className="wrap">{p.name}</td>
                  <td className="num">{p.id}</td>
                  <td className="num">{rial(p.price)}</td>
                  <td className="num">{rial(p.cost_price)}</td>
                  <td className={`num ${pr < 0 ? 'neg' : ''}`}>{rial(pr)}</td>
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
    </>
  );
}
