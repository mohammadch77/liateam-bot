// Steps 14 + 15 (deploy/shop-db-roles-014-partner-pricing.sql, -015-partner-percent.sql) against the local Docker
// Postgres: the three modes by name, the partner base capped at OUR_BASE_MARGIN_PERCENT (4%), the purchase-price floor,
// the best single discount (replace, not add), the loss tick, the cap, the «special» flag and the pack price. The shop
// role gets prices and flags only. Run: npm run test:unit (needs `npm run db:up` in the root).
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
// price, cost, Liateam's own sale %, mode, manual %, manual toman, loss tick, base margin → "final|clamped"
const price = (p, cost, consumer, mode, pct = 0, amt = 0, loss = false, base = 4) =>
  psql(
    'lia',
    `SELECT final_toman || '|' || (CASE WHEN clamped THEN 't' ELSE 'f' END) FROM public.shop_offer_price_mode(${p}, ${cost}, ${consumer}, '${mode}', ${pct}, ${amt}, ${base}, 30, 1, ${loss})`,
  );

const LIST = 1_000_000;

test('partner base: the real partner discount is capped at OUR_BASE_MARGIN_PERCENT (4%), never a «1%»', () => {
  assert.equal(price(LIST, 950_000, 0, 'partner'), '960000|f'); // real 5% → 4% off
  assert.equal(price(LIST, 960_000, 0, 'partner'), '960000|t'); // real 4% → 4% off (it is the cost)
  assert.equal(price(LIST, 860_000, 0, 'partner'), '960000|f'); // real 14% → still the announced 4%
  assert.equal(price(579_000, 555_840, 0, 'partner'), '555900|t'); // 4% of 579000, up to 100
});

test('partner: a product with less than 4% real discount gets that smaller one — never under cost', () => {
  assert.equal(price(LIST, 970_000, 0, 'partner'), '970000|t'); // real 3%
  assert.equal(price(LIST, LIST, 0, 'partner'), '1000000|t'); // no partner discount at all
});

test('partner: the base can be changed with the base margin (OUR_BASE_MARGIN_PERCENT)', () => {
  assert.equal(price(LIST, 900_000, 0, 'partner', 0, 0, false, 6), '940000|f'); // 6% instead of 4%
  assert.equal(price(LIST, 960_000, 0, 'partner', 0, 0, false, 6), '960000|t'); // but never under cost
});

test('partner: discounts compete (the best single one), they never add up; the cost floor holds', () => {
  assert.equal(price(LIST, 950_000, 0, 'partner', 4.5, 0, false), '955000|f'); // 4.5%, not 4 + 4.5, above cost: no tick
  assert.equal(price(LIST, 950_000, 0, 'partner', 6, 0, false), '950000|t'); // 6% would be under cost: held at cost
  assert.equal(price(LIST, 950_000, 0, 'partner', 6, 0, true), '940000|t'); // with «sell at a loss»: exactly 6%
  assert.equal(price(LIST, 950_000, 0, 'partner', 0, 60_000, true), '940000|t'); // an amount counts the same
  assert.equal(price(LIST, 950_000, 0, 'partner', 2), '960000|f'); // smaller than the base: nothing changes
  // Liateam's own sale (15%) replaces the 4% base: the purchase price already includes it (81% of the list price)
  assert.equal(price(LIST, 810_000, 15, 'partner'), '850000|f');
});

test('partner: the cap holds, and a price never goes above the list price', () => {
  assert.equal(price(LIST, 950_000, 0, 'partner', 60, 0, true), '700000|t'); // cap 30%
  assert.equal(price(LIST, 1_200_000, 0, 'partner'), '1000000|t'); // cost above the list price
});

test('consumer and beyond_base keep their meanings (old names still work)', () => {
  assert.equal(price(LIST, 960_000, 0, 'consumer'), '1000000|f');
  assert.equal(price(LIST, 810_000, 15, 'consumer'), '850000|f');
  assert.equal(price(LIST, 810_000, 15, 'liateam'), '850000|f');
  assert.equal(price(LIST, 960_000, 0, 'beyond_base', 0, 0, false, 3), '990000|f'); // (4 − 3)% = 1%, as before
  assert.equal(price(LIST, 960_000, 0, 'excess', 0, 0, false, 3), '990000|f');
});

const someId = () =>
  psql('lia', `SELECT min(id) FROM public.product_catalog WHERE price > 0 AND cost_price > 0`);

test('the shop role gets final price, clamped, special, base_pct (≤ 4) and max_pct — no cost', () => {
  const row = psql(
    'lia_shop_staging',
    `SELECT final_toman || '|' || clamped || '|' || special || '|' || base_pct || '|' || max_pct
       FROM public.shop_offer_prices_v3(ARRAY[${someId()}]::int[],
         ARRAY[0]::numeric[], ARRAY[0]::bigint[], ARRAY[false], 'partner', 4, 30, 1)`,
  );
  const [final, , special, base, max] = row.split('|');
  assert.ok(Number(final) > 0);
  assert.equal(special, 'false', 'the base alone is not a special offer');
  assert.ok(Number(base) > 0 && Number(base) <= 4, `base ${base}`);
  assert.ok(Number(max) >= Number(base), 'the no-tick maximum is at least the base');
  assert.throws(() =>
    psql('lia_shop_staging', `SELECT * FROM public.shop_offer_price_mode(1,1,0,'partner',0,0,4,30,1,false)`),
  );
});

test('«special» only for a discount beyond the base', () => {
  const sp = (pct, loss) =>
    psql(
      'lia_shop_staging',
      `SELECT special FROM public.shop_offer_prices_v3(ARRAY[${someId()}]::int[],
         ARRAY[${pct}]::numeric[], ARRAY[0]::bigint[], ARRAY[${loss}], 'partner', 4, 30, 1)`,
    );
  assert.equal(sp(0, false), 'f');
  assert.equal(sp(40, true), 't'); // a big admin discount with the tick
});

test('a pack with no discount is the sum of its items (even with an unknown purchase price) and never «clamped»', () => {
  const ids = psql(
    'lia',
    `SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.product_catalog WHERE price > 0 AND cost_price > 0 ORDER BY id LIMIT 3) x`,
  );
  const total = Number(psql('lia', `SELECT sum(price) FROM public.product_catalog WHERE id IN (${ids})`));
  assert.equal(
    psql(
      'lia_shop_staging',
      `SELECT final_toman || '|' || clamped FROM public.shop_pack_price(ARRAY[${ids}], ${total}, 'percent', 0, 0, false)`,
    ),
    `${total}|false`,
  );
  // an id the database cannot price (unknown product) does not hide a pack without a discount
  assert.equal(
    psql(
      'lia_shop_staging',
      `SELECT final_toman FROM public.shop_pack_price(ARRAY[${ids},999999999], ${total}, 'percent', 0, 0, false)`,
    ),
    String(total),
  );
  // a pack discount needs the purchase prices: an unknown one gives no row; a deep discount reaches the floor
  assert.equal(
    psql(
      'lia_shop_staging',
      `SELECT count(*) FROM public.shop_pack_price(ARRAY[${ids},999999999], ${total}, 'percent', 10, 0, false)`,
    ),
    '0',
  );
  assert.equal(
    psql(
      'lia_shop_staging',
      `SELECT clamped FROM public.shop_pack_price(ARRAY[${ids}], ${total}, 'percent', 40, 0, false)`,
    ),
    't',
  );
});
