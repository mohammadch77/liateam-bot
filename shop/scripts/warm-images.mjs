// Fills the image cache before visitors arrive. Supplier pictures are 1–6 MB PNGs; the first request for each
// size makes our server download and resize it, which can time out when a page asks for 20 at once. This walks
// every visible product image through /_next/image with limited concurrency, so later visits hit the cache.
//   npm run images:warm                      (app on http://127.0.0.1:$PORT)
//   npm run images:warm -- http://127.0.0.1:3850
// Run it after each catalog sync (it is idempotent: cached entries return immediately).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));

// The widths browsers actually pick for cards (1× / 2×) and the product page; must exist in next.config images.
const WIDTHS = [240, 390, 640, 828];
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
await db.end();

const jobs = rows.flatMap((r) => WIDTHS.map((w) => ({ src: r.image_url, w })));
const total = jobs.length;
const retry = [];
let done = 0;
const started = Date.now();

async function warm(job) {
  const u = `${base}/_next/image?url=${encodeURIComponent(job.src)}&w=${job.w}&q=${QUALITY}`;
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

console.log(`[images:warm] ${rows.length} images × ${WIDTHS.length} sizes via ${base}`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
// the biggest PNGs can time out while others download in parallel: one more try each, one at a time
let failed = 0;
if (retry.length) console.log(`  retrying ${retry.length} one by one…`);
for (const job of retry) if (!(await warm(job))) failed++;
console.log(
  `[images:warm] done: ${total - failed} ok, ${failed} failed, ${Math.round((Date.now() - started) / 1000)}s`,
);
process.exit(failed ? 1 : 0);
