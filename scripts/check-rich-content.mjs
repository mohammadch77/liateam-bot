// Checks the rich product-page sections end to end. Exit 1 on any failure.
//   node scripts/check-rich-content.mjs            saved pages in explore/output/pdp (no network)
//   node scripts/check-rich-content.mjs --live 10  10 random product pages read now (6-18 s apart)
// 1. Every section a Liateam page has (specs, how-to-use, video, FAQ, reviews, gallery in order, brand) is in our database too.
// 2. Nothing the shop can read is a cost: no cost_price / payable / production price for the shop roles, and no
//    price-like column in the rich-content tables. Stored text holds no HTML.
import fs from 'node:fs';
import { openDb } from '../src/db.mjs';
import { parseProductDetails } from '../src/product-details.mjs';
import { fetchProductPages } from '../src/source.mjs';

const SHOP_ROLES = ['lia_shop', 'lia_shop_staging'];
const db = await openDb();
const failures = [];
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures.push(name);
};

try {
  // ── 1. source sections → our database ──
  const pages = new Map();
  const live = process.argv.indexOf('--live');
  if (live > 0) {
    const n = Number(process.argv[live + 1] ?? 10);
    const { rows } = await db.query(
      'SELECT id FROM supplier_products WHERE missing_since IS NULL AND content_hashes IS NOT NULL ORDER BY random() LIMIT $1', [n]);
    for (const [id, e] of await fetchProductPages(rows.map((r) => r.id))) if (e?.details.found) pages.set(id, e.details);
  } else {
    const dir = 'explore/output/pdp';
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const id = Number.parseInt(f, 10);
      const d = parseProductDetails(fs.readFileSync(`${dir}/${f}`, 'utf8'), id);
      if (d.found) pages.set(id, d);
    }
  }
  ok('source pages to compare', pages.size > 0, `${pages.size} pages`);
  const missing = {};
  for (const [id, d] of pages) {
    const { rows: [p] } = await db.query(
      `SELECT p.brand_code, p.how_to_use, p.video_url, p.video_embed_url, p.summary, cardinality(p.features) AS features,
              (SELECT count(*)::int FROM product_attributes WHERE product_id = p.id) AS attributes,
              (SELECT count(*)::int FROM product_faqs WHERE product_id = p.id) AS faqs,
              (SELECT count(*)::int FROM product_reviews WHERE product_id = p.id) AS reviews,
              (SELECT array_agg(url ORDER BY position) FROM product_images WHERE product_id = p.id) AS gallery,
              EXISTS (SELECT 1 FROM brands b WHERE b.code = p.brand_code) AS brand_row
         FROM supplier_products p WHERE p.id = $1`, [id]);
    const x = d.rich;
    const need = {
      brand: x.brandCode && !(p?.brand_code === x.brandCode && p.brand_row),
      attributes: x.attributes.length && !(p?.attributes >= x.attributes.length),
      features: x.features.length && !(p?.features >= x.features.length),
      how_to_use: x.howToUse && !p?.how_to_use,
      video: x.video && !(p?.video_url || p?.video_embed_url),
      faqs: x.faqs.length && !(p?.faqs >= x.faqs.length),
      reviews: x.reviews.length && !(p?.reviews >= Math.min(4, x.reviews.length)),
      gallery: x.gallery.length && JSON.stringify(p?.gallery ?? []) !== JSON.stringify(x.gallery.map((g) => g.url)),
    };
    for (const [k, bad] of Object.entries(need)) if (bad) (missing[k] ??= []).push(id);
  }
  for (const k of ['brand', 'attributes', 'features', 'how_to_use', 'video', 'faqs', 'reviews', 'gallery']) {
    const has = [...pages.values()].filter((d) => (k === 'brand' ? d.rich.brandCode : k === 'how_to_use' ? d.rich.howToUse
      : k === 'video' ? d.rich.video : d.rich[k].length)).length;
    ok(`${k}: in our DB wherever Liateam has it`, !missing[k], `${has}/${pages.size} have it at the source` +
      (missing[k] ? `; missing for ${missing[k].slice(0, 10).join(', ')}` : ''));
  }

  // ── 2. nothing the shop reads is a cost ──
  const { rows: roles } = await db.query('SELECT rolname FROM pg_roles WHERE rolname = ANY ($1)', [SHOP_ROLES]);
  // no shop roles = the shop is not installed on this server (nothing can read the catalog): skipped, not failed
  if (!roles.length) console.log('– shop roles: none on this server (shop not installed) — grant checks skipped');
  else ok('shop roles exist (grants checked)', true, roles.map((r) => r.rolname).join(', '));
  for (const { rolname } of roles) {
    const { rows } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns c
        WHERE table_schema = 'public' AND has_column_privilege($1, format('public.%I', table_name), column_name, 'SELECT')`,
      [rolname]);
    const leaked = rows.filter((r) => /cost|payable|production|purchase|unit_cost|liateam_total|discount/i.test(r.column_name));
    ok(`${rolname}: no cost column readable`, !leaked.length,
      leaked.length ? leaked.map((r) => `${r.table_name}.${r.column_name}`).join(', ') : `${rows.length} readable columns`);
    const { rows: [rich] } = await db.query(
      `SELECT bool_and(has_table_privilege($1, t, 'SELECT')) AS ok
         FROM unnest(array['public.brands','public.product_attributes','public.product_faqs','public.product_reviews','public.product_images']) t`,
      [rolname]);
    ok(`${rolname}: can read the rich-content tables`, !!rich.ok);
  }
  const { rows: priceCols } = await db.query(
    `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('brands','product_attributes','product_faqs','product_reviews','product_images')
        AND column_name ~* '(price|cost|payable|discount)'`);
  ok('rich-content tables have no price-like column', !priceCols.length, priceCols.map((r) => r.c).join(', '));
  const { rows: [html] } = await db.query(
    `SELECT (SELECT count(*) FROM supplier_products WHERE concat_ws(' ', description, summary, how_to_use) ~* '<[a-z/!]')
          + (SELECT count(*) FROM product_attributes WHERE key || value ~* '<[a-z/!]')
          + (SELECT count(*) FROM product_faqs WHERE question || answer ~* '<[a-z/!]')
          + (SELECT count(*) FROM product_reviews WHERE concat_ws(' ', body, reply) ~* '<[a-z/!]') AS n`);
  ok('stored text has no HTML tags', Number(html.n) === 0, `${html.n} rows`);
  const { rows: [cov] } = await db.query(
    `SELECT count(*)::int AS total, count(content_hashes)::int AS read, count(slug_en)::int AS slugged,
            count(*) FILTER (WHERE slug_en !~ '^[a-z0-9]+(-[a-z0-9]+)*$')::int AS bad_slug
       FROM supplier_products WHERE missing_since IS NULL`);
  ok('English slugs are ASCII and end with the code', cov.bad_slug === 0,
    `${cov.read}/${cov.total} pages read, ${cov.slugged}/${cov.total} slugged`);
  const { rows: [dup] } = await db.query(
    `SELECT count(*)::int AS n FROM supplier_products WHERE slug_en IS NOT NULL AND slug_en !~ ('-' || id || '$')`);
  ok('every English slug ends with its own product code', dup.n === 0);
} finally {
  await db.end();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
