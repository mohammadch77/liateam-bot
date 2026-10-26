// Step 14 (deploy/shop-db-roles-014-partner-pricing.sql) against the local Docker Postgres: the three modes by name,
// the partner base (zero margin), the best single discount (replace, not add), the loss tick, the cap, the «special»
// flag and the pack price. Run: npm run test:unit (needs `npm run db:up` in the root).
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
// price, cost, Liateam's own sale %, mode, manual %, manual toman, no_floor → "final|clamped"
const price = (p, cost, consumer, mode, pct = 0, amt = 0, loss = false) =>
  psql(
    'lia',
    `SELECT final_toman || '|' || clamped FROM public.shop_offer_price_mode(${p}, ${cost}, ${consumer}, '${mode}', ${pct}, ${amt}, 3, 30, 1, ${loss})`,
  );

const LIST = 1_000_000;
const COST = 960_000; // Liateam's partner discount: exactly 4%

test('partner base: the customer pays the purchase price rounded up (4% off), never a «1%»', () => {
  assert.equal(price(LIST, COST, 0, 'partner'), '960000|true');
  assert.equal(price(579_000, 555_840, 0, 'partner'), '555900|true'); // 4% of 579000, up to 100
});

test('partner: discounts compete (the best single one), they never add up', () => {
  // the partner base is 4%; an admin discount of 4.5% (loss ticked) is 4.5% off the list price, not 4 + 4.5
  assert.equal(price(LIST, COST, 0, 'partner', 4.5, 0, true), '955000|true');
  // a product that is on a Liateam sale has a lower purchase price: its partner base is the whole (4 + 15)%
  assert.equal(price(LIST, 810_000, 15, 'partner'), '810000|true');
  assert.equal(price(LIST, COST, 2, 'partner'), '960000|true'); // smaller than the base: nothing changes
});

test('partner: an admin discount bigger than the base is below cost: held at cost without the loss tick', () => {
  assert.equal(price(LIST, COST, 0, 'partner', 10), '960000|true');
  assert.equal(price(LIST, COST, 0, 'partner', 10, 0, true), '900000|true'); // with the tick: exactly 10%
  assert.equal(price(LIST, COST, 0, 'partner', 0, 100_000, true), '900000|true'); // an amount counts the same
  assert.equal(price(LIST, COST, 0, 'partner', 2), '960000|true'); // smaller than the base: no effect
});

test('partner: the cap holds, and a discount never raises the price above the list price', () => {
  assert.equal(price(LIST, COST, 0, 'partner', 60, 0, true), '700000|true'); // cap 30%
  assert.equal(price(LIST, LIST, 0, 'partner'), '1000000|true'); // no partner discount on this product
});

test('consumer and beyond_base keep their meanings (old names still work)', () => {
  assert.equal(price(LIST, COST, 0, 'consumer'), '1000000|false');
  assert.equal(price(LIST, 810_000, 15, 'consumer'), '850000|false');
  assert.equal(price(LIST, 810_000, 15, 'liateam'), '850000|false');
  assert.equal(price(LIST, COST, 0, 'beyond_base'), '990000|false'); // (4 − base margin 3)% = 1%, as before
  assert.equal(price(LIST, COST, 0, 'excess'), '990000|false');
});

const someId = () =>
  psql('lia', `SELECT min(id) FROM public.product_catalog WHERE price > 0 AND cost_price > 0`);

test('the shop role gets the v3 wrapper: final price, clamped, special, the public partner percent — no cost', () => {
  const row = psql(
    'lia_shop_staging',
    `SELECT final_toman || '|' || clamped || '|' || special || '|' || base_pct
       FROM public.shop_offer_prices_v3(ARRAY[${someId()}]::int[],
         ARRAY[0]::numeric[], ARRAY[0]::bigint[], ARRAY[false], 'partner', 3, 30, 1)`,
  );
  const [final, , special, base] = row.split('|');
  assert.ok(Number(final) > 0);
  assert.equal(special, 'false', 'the base alone is not a special offer');
  assert.ok(Number(base) >= 0 && Number(base) < 30);
  assert.throws(() =>
    psql('lia_shop_staging', `SELECT * FROM public.shop_offer_price_mode(1,1,0,'partner',0,0,3,30,1,false)`),
  );
});

test('«special» only for a discount beyond the base', () => {
  const sp = (pct, loss) =>
    psql(
      'lia_shop_staging',
      `SELECT special FROM public.shop_offer_prices_v3(ARRAY[${someId()}]::int[],
         ARRAY[${pct}]::numeric[], ARRAY[0]::bigint[], ARRAY[${loss}], 'partner', 3, 30, 1)`,
    );
  assert.equal(sp(0, false), 'f');
  assert.equal(sp(10, false), 'f'); // held at cost: nothing beyond the base was applied
  assert.equal(sp(10, true), 't');
});

test('a pack with no discount is the sum of its items and is not «clamped»; a discount that reaches cost is', () => {
  const ids = psql(
    'lia',
    `SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.product_catalog WHERE price > 0 AND cost_price > 0 ORDER BY id LIMIT 3) x`,
  );
  const total = Number(psql('lia', `SELECT sum(price) FROM public.product_catalog WHERE id IN (${ids})`));
  const zero = psql(
    'lia_shop_staging',
    `SELECT final_toman || '|' || clamped FROM public.shop_pack_price(ARRAY[${ids}], ${total}, 'percent', 0, 0, false)`,
  );
  assert.equal(zero, `${total}|false`);
  const deep = psql(
    'lia_shop_staging',
    `SELECT clamped FROM public.shop_pack_price(ARRAY[${ids}], ${total}, 'percent', 40, 0, false)`,
  );
  assert.equal(deep, 't');
});
