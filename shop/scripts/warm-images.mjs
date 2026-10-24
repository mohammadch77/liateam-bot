// Fills the image cache before visitors arrive. Supplier pictures are 1–6 MB PNGs; the first request for each
// size makes our server download and resize it, which can time out when a page asks for 20 at once. This walks
// every visible product image through /_next/image with limited concurrency, so later visits hit the cache.
//   npm run images:warm                      (app on http://127.0.0.1:$PORT)
//   npm run images:warm -- http://127.0.0.1:3850
//   npm run images:warm -- --any-time       (by hand at night, e.g. right after a deploy)
// Run it after the install and after a sync that changed pictures (idempotent: cached entries return at once).
// Gentle on the shared server: one picture at a time, a 1–3 s pause after each one the shop had to resize (cache hits
// cost nothing and are not paused), at most IMAGES_WARM_MAX (300) resizes per run — the next run goes on from there —
// and no run 23:00–07:00 Tehran time unless --any-time is given (the hourly timer does not give it).
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
const MAX_RESIZES = Number(process.env.IMAGES_WARM_MAX ?? 300);
const PAUSE_MS = [1000, 3000];
const QUIET_HOURS = [23, 7]; // Tehran time: from 23:00 to 07:00

const args = process.argv.slice(2);
const anyTime = args.includes('--any-time');
const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(new Date()));
if (!anyTime && (hour >= QUIET_HOURS[0] || hour < QUIET_HOURS[1])) {
  console.log(`[images:warm] ${hour}:00 Tehran is in the quiet window ${QUIET_HOURS[0]}–${QUIET_HOURS[1]}: skipped`);
  process.exit(0);
}

const base = args.find((a) => /^https?:/.test(a)) ?? `http://127.0.0.1:${process.env.PORT ?? 3850}`;
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
let done = 0;
let resized = 0;
let failed = 0;
const started = Date.now();
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0])));

/** 'hit' (already cached), 'resized' (the shop made it now) or 'failed' */
async function warm(job) {
  const u = `${base}/_next/image?url=${encodeURIComponent(job.src)}&w=${job.w}&q=${job.q ?? QUALITY}`;
  try {
    const res = await fetch(u, { headers: { accept: 'image/webp' }, signal: AbortSignal.timeout(90_000) });
    await res.arrayBuffer();
    if (!res.ok) return 'failed';
    return res.headers.get('x-nextjs-cache') === 'HIT' ? 'hit' : 'resized';
  } catch {
    return 'failed';
  }
}

console.log(
  `[images:warm] ${rows.length} product images × ${WIDTHS.length} sizes + ${hero.length} banners × ${HERO_WIDTHS.length} via ${base}, at most ${MAX_RESIZES} resizes`,
);
for (const job of jobs) {
  if (resized >= MAX_RESIZES) break;
  const result = await warm(job);
  done++;
  if (result === 'failed') failed++;
  if (result !== 'hit') {
    if (result === 'resized') resized++;
    await pause();
  }
  if (done % 100 === 0) console.log(`  ${done} / ${total} (${resized} resized)`);
}
console.log(
  `[images:warm] ${done < total ? `stopped at the cap: ${done} / ${total} checked` : 'done'}: ${resized} resized, ${failed} failed, ${Math.round((Date.now() - started) / 1000)}s`,
);
process.exit(failed ? 1 : 0);
