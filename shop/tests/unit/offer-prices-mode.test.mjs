// The price with a discount mode (deploy/shop-db-roles-012-offer-prices-mode.sql), against the local Docker
// Postgres as the owner: mode 'liateam' (the discount liateam.ir shows the customer) and 'excess' (step 9's formula),
// our manual discount on top, the cap and the purchase-price floor in both modes, and the access rules (the shop role
// may call only the wrapper). Run: npm run test:unit (needs `npm run db:up` in the root and the bot's schema).
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
// price, cost, liateam %, mode, manual %, manual toman, base margin, cap, min margin[, loss allowed] → "final|clamped"
const price = (p, cost, liateam, mode, pct, amt, base, cap, min, loss = false) =>
  psql(
    'lia',
    `SELECT final_toman || '|' || clamped FROM public.shop_offer_price_mode(${p}, ${cost}, ${liateam}, '${mode}', ${pct}, ${amt}, ${base}, ${cap}, ${min}, ${loss})`,
  );

// Liateam's real pricing (2026-10): partner discount 4% on every product; a sale «discount_product» 15% on some.
const LIST = 579_000;
const COST_SALE = 468_990; // 4% partner + 15% sale
const COST = 555_840; // 4% partner only

test("mode 'liateam': the customer gets exactly the discount liateam.ir shows", () => {
  assert.equal(price(LIST, COST_SALE, 15, 'liateam', 0, 0, 4, 30, 1), '492200|false'); // 579000 × 0.85, up to 100
});

test("mode 'liateam': no sale on Liateam → Liateam's regular price, no «1%» or any other discount", () => {
  assert.equal(price(LIST, COST, 0, 'liateam', 0, 0, 4, 30, 1), '579000|false');
});

test("mode 'excess': the old formula — the partner discount above our base margin (4 − 4 = 0)", () => {
  assert.equal(price(LIST, COST, 0, 'excess', 0, 0, 4, 30, 1), '579000|false');
  assert.equal(price(LIST, COST_SALE, 15, 'excess', 0, 0, 4, 30, 1), '492200|false'); // 19 − 4 = 15%
});

test('our manual discount comes on top in both modes; the cap still applies', () => {
  assert.equal(price(1_000_000, 700_000, 10, 'liateam', 5, 0, 4, 30, 1), '850000|false'); // 10 + 5
  assert.equal(price(1_000_000, 500_000, 25, 'liateam', 20, 0, 4, 30, 1), '700000|false'); // 45 → cap 30
});

test('the purchase-price floor holds in both modes (clamped), unless a loss was allowed', () => {
  assert.equal(price(1_000_000, 960_000, 0, 'liateam', 10, 0, 4, 30, 1), '969600|true');
  assert.equal(price(1_000_000, 960_000, 0, 'excess', 10, 0, 4, 30, 1), '969600|true');
  assert.equal(price(1_000_000, 960_000, 0, 'liateam', 10, 0, 4, 30, 1, true), '900000|true');
});

test('an unknown mode is read as liateam; never above the list price', () => {
  assert.equal(price(LIST, COST_SALE, 15, 'other', 0, 0, 4, 30, 1), '492200|false');
  assert.equal(price(LIST, COST, -5, 'liateam', 0, 0, 4, 30, 1), '579000|false');
});

test('the shop role may call the wrapper only, and gets no cost or Liateam discount', () => {
  assert.throws(() =>
    psql('lia_shop_staging', `SELECT * FROM public.shop_offer_price_mode(1,1,0,'liateam',0,0,4,30,1,false)`),
  );
  const out = psql(
    'lia_shop_staging',
    `SELECT count(*) FROM public.shop_offer_prices_mode(ARRAY[(SELECT min(id) FROM public.product_catalog WHERE price > 0)]::int[],
       ARRAY[0]::numeric[], ARRAY[0]::bigint[], ARRAY[false], 'liateam', 4, 30, 1)`,
  );
  assert.equal(out, '1');
});
