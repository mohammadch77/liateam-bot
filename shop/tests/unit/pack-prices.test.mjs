// The pack price in the database (deploy/shop-db-roles-010-pack-prices.sql) with real products of the local
// Docker DB: percent / fixed price, the purchase-price floor, a new total, unknown products, and the access rules
// (the shop role gets only the final price and a yes/no). Run: npm run test:unit (needs `npm run db:up`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const psql = (user, sql) =>
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      path.join(root, 'docker-compose.yml'),
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      user,
      '-d',
      'lia_sync',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
// two real products with a known price and purchase price (the owner's view, for the expected numbers only)
const [a, b] = psql(
  'lia',
  `SELECT id || ':' || price || ':' || cost_price FROM product_catalog
    WHERE is_sellable AND price > 0 AND cost_price > 0 ORDER BY id LIMIT 2`,
)
  .split('\n')
  .map((l) => l.split(':').map(Number));
const ids = `ARRAY[${a[0]},${b[0]}]`;
const total = a[1] + b[1];
const cost = a[2] + b[2];
const ceil100 = (n) => Math.ceil(n / 100) * 100;
const pack = (user, displayTotal, kind, value, margin = 1, loss = false) =>
  psql(
    user,
    `SELECT final_toman || '|' || clamped FROM public.shop_pack_price(${ids}, ${displayTotal}, '${kind}', ${value}, ${margin}, ${loss})`,
  );

test('percent: a small discount above the floor', () => {
  // Liateam gives us 4%: 2% off stays above cost + 1%
  assert.equal(pack('lia_shop_staging', total, 'percent', 2), `${ceil100(total * 0.98)}|false`);
});

test('percent: 10% would go under the purchase price → the floor decides (cost + 1%), clamped', () => {
  assert.equal(pack('lia_shop_staging', total, 'percent', 10), `${ceil100(cost * 1.01)}|true`);
});

test('fixed price: above the floor as given; under it → the floor; never above the items’ total', () => {
  const fixed = ceil100(total * 0.99);
  assert.equal(pack('lia_shop_staging', total, 'fixed_price', fixed), `${fixed}|false`);
  assert.equal(pack('lia_shop_staging', total, 'fixed_price', 1000), `${ceil100(cost * 1.01)}|true`);
  assert.equal(pack('lia_shop_staging', total, 'fixed_price', total * 2), `${total}|false`);
});

test('loss allowed (the admin decides): 10% really applies, reported as under the floor', () => {
  assert.equal(pack('lia_shop_staging', total, 'percent', 10, 1, true), `${ceil100(total * 0.9)}|true`);
  assert.equal(pack('lia_shop_staging', total, 'percent', 2, 1, true), `${ceil100(total * 0.98)}|false`);
});

test('a new total (Liateam changed a price): priced again from it', () => {
  const higher = total + 100_000;
  assert.equal(pack('lia_shop_staging', higher, 'percent', 2), `${ceil100(higher * 0.98)}|false`);
});

test('an unknown product → no price (the shop shows the pack as unavailable)', () => {
  assert.equal(
    psql(
      'lia_shop_staging',
      `SELECT count(*) FROM public.shop_pack_price(ARRAY[${a[0]}, 99999999], ${total}, 'percent', 2, 1, false)`,
    ),
    '0',
  );
});

test('access: only final price and a yes/no; the shop role cannot read cost_price; others cannot call it', () => {
  const json = psql(
    'lia_shop_staging',
    `SELECT row_to_json(x)::text FROM public.shop_pack_price(${ids}, ${total}, 'percent', 2, 1, false) x`,
  );
  assert.deepEqual(Object.keys(JSON.parse(json)).sort(), ['clamped', 'final_toman']);
  assert.ok(!json.includes(String(cost)) && !json.includes(String(a[2])) && !json.includes(String(b[2])));
  assert.throws(
    () => psql('lia_shop_staging', 'SELECT cost_price FROM public.product_catalog LIMIT 1'),
    /permission denied/,
  );
  const grantees = psql(
    'lia',
    `SELECT string_agg(grantee, ',' ORDER BY grantee) FROM information_schema.routine_privileges
      WHERE routine_name = 'shop_pack_price' AND privilege_type = 'EXECUTE' AND grantee <> 'lia'`,
  );
  assert.equal(grantees, 'lia_shop,lia_shop_staging');
});
