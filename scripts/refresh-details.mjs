// Re-reads brand + description for specific products now (instead of waiting for the weekly re-read).
//   npm run details:refresh -- 541 532
// Same rules as the sync: one product page each (with the usual pause), written only if the text changed.
import { openDb, saveDetails } from '../src/db.mjs';
import { fetchProductPages } from '../src/source.mjs';

const ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (!ids.length) {
  console.error('usage: npm run details:refresh -- <product code> [more codes…]');
  process.exit(1);
}
const db = await openDb();
let failed = 0;
try {
  await fetchProductPages(ids, async (id, entry) => {
    if (!entry || !entry.details.found) {
      failed++;
      console.log(`${id}: page could not be read — nothing changed`);
      return;
    }
    const r = await saveDetails(db, id, entry.details);
    console.log(`${id}: ${r} (brand: ${entry.details.brand ?? '—'}, description: ${entry.details.description ? `${entry.details.description.length} chars` : '—'})`);
  });
} finally {
  await db.end();
}
process.exit(failed ? 1 : 0);
