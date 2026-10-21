// Runs the end-to-end tests one after another and prints a summary (README Ãƒâ€šÃ‚Â«ÃƒËœÃ‚ÂªÃƒËœÃ‚Â³ÃƒËœÃ‚ÂªÃƒÂ¢Ã¢â€šÂ¬Ã…â€™Ãƒâ„¢Ã¢â‚¬Â¡ÃƒËœÃ‚Â§Ãƒâ€ºÃ…â€™ end-to-endÃƒâ€šÃ‚Â»).
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
];
const wanted = process.argv.slice(2);
const unknown = wanted.filter((n) => !ALL.includes(n));
if (unknown.length) {
  console.error(`unknown test(s): ${unknown.join(', ')} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â available: ${ALL.join(', ')}`);
  process.exit(2);
}

const summary = [];
for (const name of wanted.length ? wanted : ALL) {
  console.log(`\nÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â ${name} ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, `${name}.e2e.mjs`)], { stdio: 'inherit' });
  summary.push({ name, ok: r.status === 0, s: Math.round((Date.now() - started) / 1000) });
}
console.log('\nÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â summary ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â');
for (const t of summary)
  console.log(`${t.ok ? 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“' : 'ÃƒÂ¢Ã…â€œÃ¢â‚¬â€'} ${t.name}  (${t.s}s)`);
process.exitCode = summary.every((t) => t.ok) ? 0 : 1;
