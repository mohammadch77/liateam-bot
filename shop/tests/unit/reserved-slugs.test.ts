// Products live at the site root (/<slug>). The reserved first segments (src/lib/reserved-slugs.ts) must cover
// every real top-level route of src/app (route groups unwrapped), and no product address may be one of them.
// The product part reads the local Docker database (skipped when it is not running). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESERVED_SLUGS, isReservedSlug } from '../../src/lib/reserved-slugs.ts';

const shop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.join(shop, 'src', 'app');

/** first path segments the app serves itself: folders (groups unwrapped, private _x and dynamic [x] skipped) */
function topLevelRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (/^\(.+\)$/.test(e.name)) out.push(...topLevelRoutes(path.join(dir, e.name)));
    else if (!e.name.startsWith('_') && !e.name.startsWith('[')) out.push(e.name);
  }
  return out;
}

test('every top-level route of src/app is reserved', () => {
  const missing = topLevelRoutes(app).filter((r) => !RESERVED_SLUGS.has(r));
  assert.deepEqual(missing, [], `add to src/lib/reserved-slugs.ts: ${missing.join(', ')}`);
});

test('the old prefix and the files at the root are reserved; matching ignores case', () => {
  for (const s of ['p', 'robots.txt', 'sitemap.xml', 'api', '_next']) assert.ok(isReservedSlug(s), s);
  assert.ok(isReservedSlug('Shop'));
  assert.ok(!isReservedSlug('serge-riml-abro-541'));
});

function productSlugs(): Array<{ id: number; slug: string }> | null {
  try {
    const out = execFileSync(
      'docker',
      [
        'compose',
        '-f',
        path.join(shop, '..', 'docker-compose.yml'),
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'lia',
        '-d',
        'lia_sync',
        '-At',
        '-c',
        `SELECT id || ' ' || slug_en FROM product_catalog WHERE slug_en IS NOT NULL`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [id, slug] = l.split(' ');
        return { id: Number(id), slug: slug ?? '' };
      });
  } catch {
    return null;
  }
}

test('no product slug is a reserved segment or a real route, and each carries its id', (t) => {
  const rows = productSlugs();
  if (!rows) return t.skip('local database not running');
  assert.ok(rows.length > 0);
  const routes = new Set(topLevelRoutes(app));
  const clash = rows.filter((r) => isReservedSlug(r.slug) || routes.has(r.slug));
  assert.deepEqual(clash, []);
  const noId = rows.filter((r) => !r.slug.endsWith(`-${r.id}`));
  assert.deepEqual(noId, [], 'every English slug ends with -<id> (unique, never a word)');
});
