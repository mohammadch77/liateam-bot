// Filtered product list as CSV or XLSX. Same filter/sort as the table (lib/products.js).
import ExcelJS from 'exceljs';
import { cookies } from 'next/headers';
import { getProducts } from '@/lib/data';
import { COLUMNS, applyFilters } from '@/lib/products';
import { COOKIE, verifySession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!(await verifySession((await cookies()).get(COOKIE)?.value))) return new Response('Unauthorized', { status: 401 });
  const p = Object.fromEntries(req.nextUrl.searchParams);
  const rows = applyFilters(await getProducts(), p);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const values = rows.map((r) => COLUMNS.map((c) => c.get(r) ?? ''));

  if (p.fmt === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('محصولات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.addRow(COLUMNS.map((c) => c.label)).font = { bold: true };
    for (const v of values) ws.addRow(v);
    COLUMNS.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.key === 'name' ? 44 : c.key === 'category' ? 30 : 16;
      if (c.num && c.key !== 'id') col.numFmt = '#,##0';
    });
    return new Response(await wb.xlsx.writeBuffer(), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="products-${stamp}.xlsx"`,
      },
    });
  }
  // CSV with BOM so Excel opens Persian text correctly. Leading =+-@ are neutralised (formula injection).
  const cell = (v) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [COLUMNS.map((c) => c.label), ...values].map((r) => r.map(cell).join(',')).join('\r\n');
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="products-${stamp}.csv"` },
  });
}
