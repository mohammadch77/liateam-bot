// Fills the image cache before visitors arrive. Supplier pictures are 1–6 MB PNGs; the first request for each
// size makes our server download and resize it, which can time out when a page asks for 20 at once. This walks
// every visible product image through /_next/image with limited concurrency, so later visits hit the cache.
//   npm run images:warm                      (app on http://127.0.0.1:$PORT)
//   npm run images:warm -- http://127.0.0.1:3850
// Run it after the install and after a sync that changed pictures (idempotent: cached entries return at once).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));

// The widths browsers actually pick (must exist in next.config images): menu cards and pack steps 160, cards 240 /
// 390 (and their 2× 640 / 828), gallery and promo tiles 320 / 640; hero banners also at the wide sizes.
const WIDTHS = [160, 240, 320, 390, 640, 828];
const HERO_WIDTHS = [640, 828, 1080, 1440, 1920];
const HERO_QUALITY = 75; // the only quality next.config allows (the slider's 80 is rounded to it)
const QUALITY = 75;
const CONCURRENCY = 2;

const base = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? 3850}`;
const { DATABASE_URL: url } = process.env;
if (!url) {
  console.error('[images:warm] DATABASE_URL is required');
  process.exit(1);
}

const db = new pg.Client({ connectionString: url });
await db.connect();
const { rows } = await db.query(
  `SELECT DISTINCT image_url FROM product_catalog
    WHERE image_url IS NOT NULL AND is_sellable AND price > 0 AND missing_since IS NULL`,
);
// the home slider's banners (wide and tall); absent before grants 007
const hero = await db
  .query(`SELECT image_url, portrait_url FROM hero_slides`)
  .then((r) => r.rows.flatMap((h) => [h.image_url, h.portrait_url]).filter(Boolean))
  .catch(() => []);
await db.end();

const jobs = [
  ...hero.flatMap((src) => HERO_WIDTHS.map((w) => ({ src, w, q: HERO_QUALITY }))),
  ...rows.flatMap((r) => WIDTHS.map((w) => ({ src: r.image_url, w }))),
];
const total = jobs.length;
const retry = [];
let done = 0;
const started = Date.now();

async function warm(job) {
  const u = `${base}/_next/image?url=${encodeURIComponent(job.src)}&w=${job.w}&q=${job.q ?? QUALITY}`;
  try {
    const res = await fetch(u, { headers: { accept: 'image/webp' }, signal: AbortSignal.timeout(90_000) });
    await res.arrayBuffer();
    return res.ok;
  } catch {
    return false;
  }
}

async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    if (!(await warm(job))) retry.push(job);
    if (++done % 50 === 0) console.log(`  ${done} / ${total}`);
  }
}

console.log(
  `[images:warm] ${rows.length} product images × ${WIDTHS.length} sizes + ${hero.length} banners × ${HERO_WIDTHS.length} via ${base}`,
);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
// the biggest PNGs can time out while others download in parallel: one more try each, one at a time
let failed = 0;
if (retry.length) console.log(`  retrying ${retry.length} one by one…`);
for (const job of retry) if (!(await warm(job))) failed++;
console.log(
  `[images:warm] done: ${total - failed} ok, ${failed} failed, ${Math.round((Date.now() - started) / 1000)}s`,
);
process.exit(failed ? 1 : 0);
