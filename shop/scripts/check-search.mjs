// Search guard. Checks, against the database and the running app:
//   1. normalizeSearch (src/lib/search/normalize.ts) gives exactly what public.search_norm gives, for every product
//      name and brand plus tricky samples (Arabic ي/ك, ZWNJ, آ, digits, harakat) — otherwise highlighting and
//      matching drift apart;
//   2. the suggest API answers misspellings and Arabic letters, and never returns more than the public fields.
//   npm run check:search                    (app on http://127.0.0.1:3850)
//   npm run check:search -- http://host:port
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));
const base = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? 3850}`;
const { normalizeSearch } = await import(pathToFileURL(path.join(root, 'src/lib/search/normalize.ts')).href);

let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query('SELECT name, brand FROM product_catalog');
const samples = [
  ...rows.flatMap((r) => [r.name, r.brand].filter(Boolean)),
  'ريمل ابروي مشكي',
  'سرم‌ابرو',
  'آرایشی أإؤ ة ۀ',
  'کرم ۱۲۳ ٤٥٦ SPF50+',
  'مَژه‌ی بلـند',
  'CC-کرم (بی‌رنگ)',
];
const { rows: sql } = await db.query('SELECT public.search_norm(t) AS n FROM unnest($1::text[]) AS t', [samples]);
const diff = samples.filter((t, i) => normalizeSearch(t) !== sql[i].n);
check(!diff.length, `normalizer matches the database for ${samples.length} texts${diff.length ? `: ${diff.slice(0, 3).join(' | ')}` : ''}`);
await db.end();

const PUBLIC = ['brand', 'href', 'imageUrl', 'inStock', 'name', 'priceToman'].join();
for (const [q, expect] of [
  ['ریمل', /^ریمل/],
  ['ريمل', /^ریمل/],
  ['رمل', /^ریمل/],
  ['شامپ', /^شامپو/],
]) {
  const res = await fetch(`${base}/api/search/suggest?q=${encodeURIComponent(q)}`);
  const j = await res.json();
  const first = j.products?.[0];
  check(res.ok && expect.test(first?.name ?? ''), `suggest «${q}» → ${first?.name ?? res.status}`);
  check(
    (j.products ?? []).every((p) => Object.keys(p).sort().join() === PUBLIC) && !/cost/i.test(JSON.stringify(j)),
    `suggest «${q}» returns only public fields`,
  );
}
const bad = await fetch(`${base}/api/search/suggest?q=${'x'.repeat(200)}`);
check(bad.status === 422, `an over-long query is refused (${bad.status})`);

console.log(failures ? `\n${failures} check(s) failed` : '\nsearch OK');
process.exitCode = failures ? 1 : 0; // not process.exit(): open fetch sockets crash Node on Windows
