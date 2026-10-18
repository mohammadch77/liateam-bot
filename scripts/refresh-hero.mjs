// Reads Liateam's home-page hero slides now (instead of waiting for the next run) and prints what was kept/skipped.
//   npm run hero:refresh                     one request to liateam.ir (after a short pause)
//   npm run hero:refresh -- --file <path>    from a saved RSC payload (no network)
// Same rules as the sync: written only when the slides changed.
import fs from 'node:fs';
import { openDb, saveHeroSlides } from '../src/db.mjs';
import { parseHeroSlides, heroHash, SKIP_REASON_FA } from '../src/hero.mjs';
import { fetchHomePage } from '../src/source.mjs';

const at = process.argv.indexOf('--file');
const text = at > 0 ? fs.readFileSync(process.argv[at + 1], 'utf8') : await fetchHomePage();
const parsed = parseHeroSlides(text);
if (!parsed.found) {
  console.error('no slider list on the page — nothing changed');
  process.exit(1);
}
const db = await openDb();
try {
  const r = await saveHeroSlides(db, parsed, heroHash);
  console.log(`${r.slides.length} slides ${r.changed ? 'written' : 'unchanged'}`);
  for (const [i, s] of r.slides.entries()) console.log(`  ${i + 1}. ${s.alt ?? '—'} → ${s.target_type} ${s.target_code}`);
  if (r.skipped.length) console.log(`${r.skipped.length} skipped:`);
  for (const s of r.skipped) console.log(`  ${s.source_code} ${s.title ?? '—'} (${s.link}): ${SKIP_REASON_FA[s.reason] ?? s.reason}`);
} finally {
  await db.end();
}
