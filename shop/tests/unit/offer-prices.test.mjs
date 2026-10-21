// The price formula in the database (deploy/shop-db-roles-009-offer-prices.sql), run against the local Docker
// Postgres as the owner with plain numbers, plus the access rules: the shop role may call only the wrapper, which
// returns the final price and a yes/no, nothing else. Run: npm run test:unit (needs `npm run db:up` in the root).
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
// price, cost, manual %, manual toman, base margin, cap, min margin → "final|clamped"
const price = (...a) =>
  psql('lia', `SELECT final_toman || '|' || clamped FROM public.shop_offer_price(${a.join(',')})`);

test('pass-through: Liateam 10% to us, base margin 4% → the customer gets 6%', () => {
  assert.equal(price(1_000_000, 900_000, 0, 0, 4, 30, 0), '940000|false');
});

test('pass-through: Liateam 4% (= our base margin) or less → nothing passes', () => {
  assert.equal(price(1_000_000, 960_000, 0, 0, 4, 30, 0), '1000000|false');
  assert.equal(price(1_000_000, 980_000, 0, 0, 4, 30, 0), '1000000|false');
});

test('pass-through + manual, capped at the maximum percent', () => {
  assert.equal(price(1_000_000, 800_000, 3, 0, 4, 30, 0), '810000|false'); // 16 + 3 = 19%
  assert.equal(price(1_000_000, 500_000, 40, 0, 4, 30, 0), '700000|false'); // 46 + 40 → 30%
  assert.equal(price(1_000_000, 800_000, 0, 30_000, 4, 30, 0), '810000|false'); // amount = 3%
  // 6% passed through + 5% of ours would go under the purchase price: the floor decides
  assert.equal(price(1_000_000, 900_000, 5, 0, 4, 30, 0), '900000|true');
});

test('floor: never under cost + minimum margin; the floor decides → clamped', () => {
  assert.equal(price(1_000_000, 960_000, 10, 0, 4, 30, 0), '960000|true');
  assert.equal(price(1_000_000, 960_000, 10, 0, 4, 30, 2), '979200|true');
  assert.equal(price(1_000_000, 960_000, 3, 0, 4, 30, 0), '970000|false');
});

test('a new Liateam price is discounted again from scratch (rounded up to 100 toman, never above the price)', () => {
  assert.equal(price(1_250_000, 1_200_000, 2, 0, 4, 30, 0), '1225000|false');
  assert.equal(price(333_333, 300_000, 0, 0, 4, 30, 0), '313400|false'); // 6.0001% off, rounded up
  assert.equal(price(100_000, 120_000, 0, 0, 4, 30, 0), '100000|true'); // cost above price: never more than the price
});

test('access: the shop role may not call the formula; the wrapper returns only id, final price and a yes/no', () => {
  assert.throws(
    () => psql('lia_shop_staging', 'SELECT * FROM public.shop_offer_price(1,1,0,0,0,0,0)'),
    /permission denied/,
  );
  assert.throws(
    () => psql('lia_shop_staging', 'SELECT cost_price FROM public.product_catalog LIMIT 1'),
    /permission denied/,
  );
  const out = psql(
    'lia_shop_staging',
    `SELECT row_to_json(x)::text FROM public.shop_offer_prices(
       ARRAY(SELECT id FROM public.product_catalog WHERE is_sellable AND price > 0 LIMIT 3),
       ARRAY[0,0,0]::numeric[], ARRAY[0,0,0]::bigint[], 4, 30, 0) x`,
  );
  for (const line of out.split('\n').filter(Boolean)) {
    assert.deepEqual(Object.keys(JSON.parse(line)).sort(), ['clamped', 'final_toman', 'id']);
  }
  // arguments outside the sane range are clamped (a negative margin cannot dig under the purchase price)
  const neg = psql(
    'lia_shop_staging',
    `SELECT bool_and(clamped) FROM public.shop_offer_prices(
       ARRAY(SELECT id FROM public.product_catalog WHERE is_sellable AND price > 0 LIMIT 3),
       ARRAY[100,100,100]::numeric[], ARRAY[0,0,0]::bigint[], -50, 500, -50) x`,
  );
  assert.equal(neg, 't');
});
