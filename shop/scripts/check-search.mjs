// Search guard. Checks, against the database and the running app:
//   1. normalizeSearch (src/lib/search/normalize-core.mjs) gives exactly what public.search_norm gives, for every product
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
const { normalizeSearch } = await import(
  pathToFileURL(path.join(root, 'src/lib/search/normalize-core.mjs')).href
);

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
const { rows: sql } = await db.query('SELECT public.search_norm(t) AS n FROM unnest($1::text[]) AS t', [
  samples,
]);
const diff = samples.filter((t, i) => normalizeSearch(t) !== sql[i].n);
check(
  !diff.length,
  `normalizer matches the database for ${samples.length} texts${diff.length ? `: ${diff.slice(0, 3).join(' | ')}` : ''}`,
);
await db.end();

const PUBLIC = ['brand', 'href', 'imageUrl', 'name', 'oldPriceToman', 'priceToman', 'stock'].join();
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
    (j.products ?? []).every((p) => Object.keys(p).sort().join() === PUBLIC) &&
      !/cost/i.test(JSON.stringify(j)),
    `suggest «${q}» returns only public fields`,
  );
}
// ── a list of real questions (Persian, Latin, misspelt, part of a word, digits): what comes back, and is it what a person wants? ──
// `want` is tested on the names of the first three products, the categories and the brands together; `kind` says which group must
// hold it. A row that fails is printed as «weak» (it is information, not a stop) unless it is marked must.
const QUESTIONS = [
  ['سرم', /سرم/, 'product', true],
  ['شامپو', /شامپو/, 'product', true],
  ['شامپ', /شامپو/, 'product', true], // part of a word
  ['ریمل', /ریمل/, 'any', true],
  ['ريمل', /ریمل/, 'any', true], // Arabic ي
  ['رمل', /ریمل/, 'any', true], // misspelt
  ['كانسيلر', /کانسیلر/, 'any', true], // Arabic ك and ي
  ['ضد آفتاب', /آفتاب/, 'any', true],
  ['ضدآفتاب', /آفتاب/, 'any', false], // without the space
  ['ضد‌آفتاب', /آفتاب/, 'any', true], // with a half-space
  ['تراست پرو', /تراست پرو/, 'brand', true],
  ['trust pro', /تراست پرو|trust/i, 'any', false], // Latin for a Persian brand
  ['سرژه', /سرژه/, 'brand', true],
  ['لایف گارد', /لایف.?گارد/, 'any', true],
  ['رژلب', /رژ لب/, 'any', true],
  ['رژ لب', /رژ لب/, 'any', true],
  ['کراتین', /کراتین/, 'product', true],
  ['کلاژن', /کلاژن/, 'product', true],
  ['کرم ابرو', /کرم ابرو/, 'product', true],
  ['بادی میست', /بادی میست/, 'any', true],
  ['power', /power/i, 'product', false], // a Latin word inside a Persian name
  ['۱۵ میل', /(15|۱۵) میل/, 'product', false], // Persian digits
  ['AHA', /AHA/i, 'product', false],
  ['ساتن', /ساتین/, 'product', false], // misspelt
  ['سروم', /سرم/, 'any', false], // misspelt
  ['لوسیون', /لوسیون/, 'any', true],
];
const weak = [];
console.log('question → first product | categories | brands (total)');
for (const [q, want, kind, must] of QUESTIONS) {
  const j = await (await fetch(`${base}/api/search/suggest?q=${encodeURIComponent(q)}`)).json();
  const pool = { product: (j.products ?? []).slice(0, 3), category: j.categories ?? [], brand: j.brands ?? [] };
  const names = (kind === 'any' ? [...pool.product, ...pool.category, ...pool.brand] : pool[kind]).map((x) => x.name);
  const ok = names.some((n) => want.test(n));
  console.log(
    `  ${ok ? '✓' : must ? '✗' : '~'} «${q}» → ${j.products?.[0]?.name ?? '—'} | ${(j.categories ?? []).map((c) => c.name).join('، ') || '—'} | ${(j.brands ?? []).map((c) => c.name).join('، ') || '—'} (${j.total})`,
  );
  if (!ok) weak.push(q);
  if (must) check(ok, `question «${q}» finds what a person wants`);
}
const gone = await (await fetch(`${base}/api/search/suggest?q=${encodeURIComponent('ماشین لباسشویی')}`)).json();
check(gone.total === 0 && gone.fallback && gone.fallback.categories.length > 0 && gone.fallback.products.length > 0, 'nothing found → the main categories and a few products are offered');
const stock = await (await fetch(`${base}/api/search/suggest?q=${encodeURIComponent('لوسیون')}`)).json();
const firstOut = (stock.products ?? []).findIndex((p) => p.stock === 'out');
check(firstOut === -1 || (stock.products ?? []).slice(firstOut).every((p) => p.stock === 'out'), 'sold-out products come after the ones that can be bought');
if (weak.length) console.log(`weak or unmatched: ${weak.join(' | ')}`);

const bad = await fetch(`${base}/api/search/suggest?q=${'x'.repeat(200)}`);
check(bad.status === 422, `an over-long query is refused (${bad.status})`);

console.log(failures ? `\n${failures} check(s) failed` : '\nsearch OK');
process.exitCode = failures ? 1 : 0; // not process.exit(): open fetch sockets crash Node on Windows
