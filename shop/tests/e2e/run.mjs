// Runs the end-to-end tests one after another and prints a summary (README Ã‚Â«Ã˜ÂªÃ˜Â³Ã˜ÂªÃ¢â‚¬Å’Ã™â€¡Ã˜Â§Ã›Å’ end-to-endÃ‚Â»).
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
];
const wanted = process.argv.slice(2);
const unknown = wanted.filter((n) => !ALL.includes(n));
if (unknown.length) {
  console.error(`unknown test(s): ${unknown.join(', ')} Ã¢â‚¬â€ available: ${ALL.join(', ')}`);
  process.exit(2);
}

const summary = [];
for (const name of wanted.length ? wanted : ALL) {
  console.log(`\nÃ¢â€ÂÃ¢â€Â ${name} Ã¢â€ÂÃ¢â€Â`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, `${name}.e2e.mjs`)], { stdio: 'inherit' });
  summary.push({ name, ok: r.status === 0, s: Math.round((Date.now() - started) / 1000) });
}
console.log('\nÃ¢â€ÂÃ¢â€Â summary Ã¢â€ÂÃ¢â€Â');
for (const t of summary) console.log(`${t.ok ? 'Ã¢Å“â€œ' : 'Ã¢Å“â€”'} ${t.name}  (${t.s}s)`);
process.exitCode = summary.every((t) => t.ok) ? 0 : 1;
