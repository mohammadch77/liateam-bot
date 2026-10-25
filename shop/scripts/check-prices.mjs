// Price guard for the storefront (the 2026-10-17 bug showed every price 10× too low). For each known product in
// ../test/price-unit.fixtures.json it checks, against the running app:
//   1. the product page shows exactly the stored price (all amounts are toman: display never divides by 10);
//   2. the stored price is in the same unit as the price Liateam displayed when the fixture was taken — a real
//      price change since then only warns; a ~10× difference fails.
//   npm run check:prices                 (app on http://127.0.0.1:3850)
//   npm run check:prices -- http://host:port
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));
const base = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? 3850}`;
const { products } = JSON.parse(fs.readFileSync(path.join(root, '../test/price-unit.fixtures.json'), 'utf8'));

const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let failures = 0;
for (const p of products) {
  const {
    rows: [row],
  } = await db.query('SELECT price, stock FROM product_catalog WHERE id = $1', [p.code]);
  if (!row) {
    console.log(`• ${p.code}: not in the catalog any more — skipped`);
    continue;
  }
  const stored = Number(row.price);
  const ratio = stored / p.displayed.price;
  const problems = [];
  if (ratio > 5 || ratio < 0.2)
    problems.push(`stored ${stored} vs Liateam ${p.displayed.price}: ×${ratio.toFixed(2)} — unit error`);

  const res = await fetch(`${base}/${p.code}`, { redirect: 'follow' });
  const html = await res.text();
  // the buy box price: <b class="…amount…">۷۴۹٬۰۰۰</b>
  const shown = /class="[^"]*buyBox[^"]*"[\s\S]*?class="[^"]*amount[^"]*">([^<]+)</.exec(html)?.[1];
  if (res.status === 200 && Number(row.stock) > 0 && shown !== fa(stored)) {
    problems.push(`page shows «${shown ?? 'nothing'}» but the stored price is ${fa(stored)}`);
  }
  const note =
    ratio !== 1 && !problems.length
      ? `  (Liateam price changed since the fixture: ${p.displayed.price} → ${stored})`
      : '';
  if (problems.length) failures++;
  console.log(
    `${problems.length ? '✗' : '✓'} ${p.code}  stored ${fa(stored)} تومان · page «${shown ?? '—'}»${note}${problems.length ? '\n    ' + problems.join('\n    ') : ''}`,
  );
}
await db.end();
console.log(failures ? `\n${failures} product(s) with a wrong price` : '\nall known prices correct');
process.exit(failures ? 1 : 0);
