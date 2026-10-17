// Step-0 survey of the rich product-page sections: reads N product pages (like a person, 6-18 s apart),
// saves each payload under explore/output/pdp/ and prints how many have each section.
// Read-only, saved session. Usage: node explore/probe-rich-sections.mjs 30
import fs from 'node:fs';
import pg from 'pg';
import { request } from 'playwright';
import { config } from '../src/config.mjs';
import { scanValue } from '../src/rsc.mjs';

const n = Number(process.argv[2] ?? 30);
const db = new pg.Client({ connectionString: config.databaseUrl });
await db.connect();
const { rows } = await db.query(
  'SELECT id FROM supplier_products WHERE missing_since IS NULL ORDER BY random() LIMIT $1',
  [n],
);
await db.end();

const ctx = await request.newContext({
  baseURL: config.baseUrl,
  storageState: config.storageStatePath,
  extraHTTPHeaders: {
    RSC: '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'fa-IR,fa;q=0.9',
  },
  maxRedirects: 0,
});
const objAfter = (t, key) => {
  const i = t.indexOf(`"${key}":`);
  if (i < 0) return undefined;
  const s = i + key.length + 3;
  try {
    return JSON.parse(t.slice(s, scanValue(t, s)));
  } catch {
    return undefined;
  }
};
fs.mkdirSync('explore/output/pdp', { recursive: true });
const count = {};
const add = (k, ok) => (count[k] = (count[k] ?? 0) + (ok ? 1 : 0));
let read = 0;
for (const { id } of rows) {
  await new Promise((r) => setTimeout(r, 6000 + Math.random() * 12000));
  const res = await ctx.get(`/products/${id}?_rsc`);
  if (res.status() !== 200) continue;
  const t = await res.text();
  fs.writeFileSync(`explore/output/pdp/${id}.rsc.txt`, t);
  read++;
  const p = objAfter(t, 'productData') ?? {};
  const comments = objAfter(t, 'comments');
  const row = {
    description: !!p.description,
    summary: !!p.summary,
    attributes: (p.attributes ?? []).length > 0,
    features: (p.features ?? []).length > 0,
    how_to_use: !!p.how_to_use,
    video: !!(p.video_link || p.video_iframe),
    faqs: (p.faqs ?? []).length > 0,
    comments: Array.isArray(comments) && comments.length > 0,
    comments4: Array.isArray(comments) && comments.length >= 4,
    brand: !!p.brand?.title,
    rating: p.rating_value != null,
  };
  for (const [k, v] of Object.entries(row)) add(k, v);
  console.log(id, Object.entries(row).filter(([, v]) => v).map(([k]) => k).join(' '));
}
await ctx.dispose();
console.log(`\n${read} pages`);
for (const [k, v] of Object.entries(count)) console.log(k.padEnd(12), `${v}/${read}`, `${Math.round((100 * v) / read)}%`);
