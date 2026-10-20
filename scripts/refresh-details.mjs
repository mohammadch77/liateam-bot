// Re-reads a product's page now (instead of waiting for the weekly re-read): brand, description and the rich
// sections (specs, how-to-use, video, FAQ, reviews), the brand list, and the English slug.
//   npm run details:refresh -- 541 532
//   npm run details:refresh -- --missing      every listed product whose rich sections (or facts / concerns / tags) were never read
//   npm run details:refresh -- --entities     every product with a raw HTML entity (&not; &bull; …) left in its stored text
//   --quiet  a repair, not news: written without change_events (with --entities it is always quiet)
// Same rules as the sync: one product page each (with the usual 1–3 s pause), written only if content changed.
import { openDb, saveDetails, saveRich, syncBrands, assignSlugs } from '../src/db.mjs';
import { sectionHashes } from '../src/product-details.mjs';
import { KNOWN_BRAND_LATIN, englishSlug, persianSlug, transliterate } from '../src/slug.mjs';
import { fetchProductPages } from '../src/source.mjs';

const db = await openDb();
let ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const ENTITY = "'&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);'";
const select = {
  '--missing': "SELECT id FROM supplier_products WHERE missing_since IS NULL AND (content_hashes IS NULL OR NOT content_hashes ? 'facts') ORDER BY id",
  '--entities': `SELECT id FROM supplier_products p WHERE missing_since IS NULL AND (
      description ~ ${ENTITY} OR summary ~ ${ENTITY} OR how_to_use ~ ${ENTITY}
      OR EXISTS (SELECT 1 FROM product_attributes a WHERE a.product_id = p.id AND (a.key ~ ${ENTITY} OR a.value ~ ${ENTITY}))
      OR EXISTS (SELECT 1 FROM product_faqs f WHERE f.product_id = p.id AND (f.question ~ ${ENTITY} OR f.answer ~ ${ENTITY}))
      OR EXISTS (SELECT 1 FROM product_reviews r WHERE r.product_id = p.id AND (r.body ~ ${ENTITY} OR r.reply ~ ${ENTITY}))
      OR EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id AND i.alt ~ ${ENTITY})) ORDER BY id`,
};
for (const [flag, q] of Object.entries(select)) {
  if (!process.argv.includes(flag)) continue;
  const { rows } = await db.query(q);
  ids = [...new Set([...ids, ...rows.map((r) => r.id)])];
  console.log(`${flag}: ${rows.length} products`);
}
const quiet = ['--quiet', '--entities'].some((f) => process.argv.includes(f));
if (!ids.length) {
  console.error('usage: npm run details:refresh -- <product code> [more codes…] | --missing | --entities [--quiet]');
  await db.end();
  process.exit(1);
}
let failed = 0;
let brands = null;
try {
  await fetchProductPages(ids, async (id, entry) => {
    if (!entry || !entry.details.found) {
      failed++;
      console.log(`${id}: page could not be read — nothing changed`);
      return;
    }
    const d = entry.details;
    const r = await saveDetails(db, id, d, { quiet });
    const sections = d.rich ? await saveRich(db, id, d.rich, sectionHashes(d.rich), { quiet }) : [];
    // mirrored with the first page, so slugs can be assigned even if the run is stopped halfway
    if (!brands && d.brands.length) {
      brands = d.brands;
      await syncBrands(db, brands, transliterate, KNOWN_BRAND_LATIN);
    }
    console.log(`${id}: ${r}, sections changed: ${sections.join(' ') || '—'} (brand: ${d.brand ?? '—'})`);
  });
  console.log(`${brands?.length ?? 0} brands mirrored, ${await assignSlugs(db, englishSlug, persianSlug)} new slugs`);
} finally {
  await db.end();
}
process.exit(failed ? 1 : 0);
