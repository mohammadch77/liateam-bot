// For each saved product page: the raw pricing fields of that product (embedded page data) next to what the page
// DISPLAYS, the value in our database, and what our shop shows. Usage: node explore/compare-prices.mjs 412 547 …
import fs from 'node:fs';
import pg from 'pg';
import { config } from '../src/config.mjs';
import { extractAll } from '../src/rsc.mjs';

const fmt = (n) => Number(n).toLocaleString('en-US');
const db = new pg.Client({ connectionString: config.databaseUrl });
await db.connect();
const rows = [];
for (const code of process.argv.slice(2).map(Number)) {
  const html = fs.readFileSync(`explore/output/price/${code}.html`, 'utf8');
  // the HTML embeds the RSC payload as escaped JSON strings inside self.__next_f.push(...)
  const data = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((m) => JSON.parse(`"${m[1]}"`))
    .join('');
  const own = extractAll(data, 'pricing').filter((x) => x && (x.code === code || x.product_code === code));
  const raw = own[0] ?? {};
  const shown = new Set([...html.matchAll(/([0-9][0-9,]{2,12}) تومان/g)].map((m) => Number(m[1].replace(/,/g, ''))));
  const {
    rows: [d],
  } = await db.query('SELECT price, cost_price FROM supplier_products WHERE id = $1', [code]);
  rows.push({
    code,
    'raw pricing.price': fmt(raw.price),
    'raw payable_price': fmt(raw.payable_price),
    'page shows price as toman': shown.has(Number(raw.price)) ? `✔ ${fmt(raw.price)}` : '✘',
    'page shows price/10 as toman': shown.has(Number(raw.price) / 10) ? `✔ ${fmt(raw.price / 10)}` : '✘',
    'our DB price': fmt(d.price),
    'our site shows (DB/10)': fmt(d.price / 10),
  });
}
await db.end();
console.table(rows);
