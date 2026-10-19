// Checks product photos on Liateam's image host now (instead of a few per run) and applies the result.
//   npm run images:check                one batch (60 addresses, 0.8–2 s apart)
//   npm run images:check -- --all       every address never checked or older than a week (backfill)
// Same rules as the sync: HEAD only, a pause before each, unknown answers retried later.
import { openDb } from '../src/db.mjs';
import { applyImageChecks, checkImages } from '../src/images.mjs';

const db = await openDb();
try {
  const all = process.argv.includes('--all');
  let checked = 0, broken = 0;
  for (;;) {
    const r = await checkImages(db, { limit: 60 });
    checked += r.checked;
    broken += r.broken;
    console.log(`batch: ${r.checked} checked, ${r.broken} broken (total ${checked} / ${broken})`);
    if (!all || r.checked === 0) break;
  }
  const a = await applyImageChecks(db);
  console.log(`${a.replaced} products show a gallery photo instead of a broken main photo, ${a.none} without a working photo`);
  const { rows } = await db.query(
    `SELECT id, name FROM supplier_products WHERE missing_since IS NULL AND image_checked AND display_image_url IS NULL ORDER BY id`);
  for (const r of rows) console.log(`  no working photo: ${r.id} ${r.name}`);
} finally {
  await db.end();
}
