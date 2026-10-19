// Re-reads a product's page now (instead of waiting for the weekly re-read): brand, description and the rich
// sections (specs, how-to-use, video, FAQ, reviews), the brand list, and the English slug.
//   npm run details:refresh -- 541 532
//   npm run details:refresh -- --missing      every listed product whose rich sections (or facts / concerns / tags) were never read
// Same rules as the sync: one product page each (with the usual 6-18 s pause), written only if content changed.
import { openDb, saveDetails, saveRich, syncBrands, assignSlugs } from '../src/db.mjs';
import { sectionHashes } from '../src/product-details.mjs';
import { KNOWN_BRAND_LATIN, englishSlug, persianSlug, transliterate } from '../src/slug.mjs';
import { fetchProductPages } from '../src/source.mjs';

const db = await openDb();
let ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (process.argv.includes('--missing')) {
  const { rows } = await db.query("SELECT id FROM supplier_products WHERE missing_since IS NULL AND (content_hashes IS NULL OR NOT content_hashes ? 'facts') ORDER BY id");
  ids = rows.map((r) => r.id);
  console.log(`${ids.length} products without rich sections (~${Math.round((ids.length * 12) / 60)} min)`);
}
if (!ids.length) {
  console.error('usage: npm run details:refresh -- <product code> [more codes…] | --missing');
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
    const r = await saveDetails(db, id, d);
    const sections = d.rich ? await saveRich(db, id, d.rich, sectionHashes(d.rich)) : [];
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
