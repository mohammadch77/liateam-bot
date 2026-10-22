// Runs the end-to-end tests one after another and prints a summary (README ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â«ÃƒÆ’Ã‹Å“Ãƒâ€šÃ‚ÂªÃƒÆ’Ã‹Å“Ãƒâ€šÃ‚Â³ÃƒÆ’Ã‹Å“Ãƒâ€šÃ‚ÂªÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã¢â€žÂ¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‹Å“Ãƒâ€šÃ‚Â§ÃƒÆ’Ã¢â‚¬ÂºÃƒâ€¦Ã¢â‚¬â„¢ end-to-endÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»).
//   npm run test:e2e                     all of them
//   npm run test:e2e -- search megamenu  only these
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALL = [
  'auth',
  'catalog',
  'megamenu',
  'search',
  'product',
  'hero',
  'nav',
  'affiliate',
  'product-layout',
  'revalidate',
  'offers',
  'packs',
  'home',
  'navmenu',
  'budget',
];
const wanted = process.argv.slice(2);
const unknown = wanted.filter((n) => !ALL.includes(n));
if (unknown.length) {
  console.error(`unknown test(s): ${unknown.join(', ')} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â available: ${ALL.join(', ')}`);
  process.exit(2);
}

const summary = [];
for (const name of wanted.length ? wanted : ALL) {
  console.log(`\nÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â ${name} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, `${name}.e2e.mjs`)], { stdio: 'inherit' });
  summary.push({ name, ok: r.status === 0, s: Math.round((Date.now() - started) / 1000) });
}
console.log('\nÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â summary ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â');
for (const t of summary)
  console.log(`${t.ok ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ' : 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'} ${t.name}  (${t.s}s)`);
process.exitCode = summary.every((t) => t.ok) ? 0 : 1;
