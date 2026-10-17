// Permanent guard for the price-unit bug of 2026-10-17 (every price shown 10× too low): Liateam's prices are
// TOMAN; the bot must store them unchanged and the sanity layer must refuse a unit switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, SOURCE_PRICE_UNIT } from '../src/normalize.mjs';
import { checkProduct, checkUnitDrift, UnitError } from '../src/sanity.mjs';

const { products: KNOWN } = JSON.parse(fs.readFileSync(new URL('./price-unit.fixtures.json', import.meta.url), 'utf8'));
const listItem = (p) => ({
  code: p.code,
  title: p.name ?? `محصول ${p.code}`,
  category_codes: [10],
  pricing: { price: p.raw.price, payable_price: p.raw.payable_price },
  inventory: { total_inventory: 50 },
});

test('the source unit is toman', () => {
  assert.equal(SOURCE_PRICE_UNIT, 'toman');
});

test('known products: stored price = the consumer price Liateam displays (toman, unchanged)', () => {
  for (const p of KNOWN) {
    const { product } = normalize(listItem(p));
    assert.equal(product.price, p.displayed.price, `product ${p.code} price`);
    assert.equal(product.cost_price, p.displayed.payable_price, `product ${p.code} cost`);
    assert.deepEqual(checkProduct(product, undefined), [], `product ${p.code} passes the sanity check`);
  }
});

test('a product read 10× too high or too low (rial / wrong field) is refused even without history', () => {
  const p412 = normalize(listItem(KNOWN[0])).product;
  const dearest = normalize(listItem(KNOWN[1])).product; // 9,770,000 toman
  // ×10: the dearest product misread as rial is above the plausible range
  assert.ok(checkProduct({ ...dearest, price: dearest.price * 10, cost_price: dearest.cost_price * 10 }, undefined)
    .some((m) => /outside the plausible range/.test(m)));
  // only one field switched unit: the cost/price ratio is impossible
  assert.ok(checkProduct({ ...p412, price: p412.price * 10 }, undefined).some((m) => /cost\/price ratio/.test(m)));
  assert.ok(checkProduct({ ...p412, cost_price: Math.round(p412.cost_price / 10) }, undefined).some((m) => /cost\/price ratio/.test(m)));
  // against the previous value the 10× jump is refused too
  assert.ok(checkProduct({ ...p412, price: p412.price / 10, cost_price: p412.cost_price / 10 }, p412).some((m) => /jumped/.test(m)));
});

test('whole catalog moving ×10 or ÷10 stops the run (UnitError), normal price changes do not', () => {
  const prev = new Map();
  const products = [];
  for (let i = 0; i < 40; i++) {
    const price = 500000 + i * 25000;
    prev.set(i, { price });
    products.push({ id: i, price: i < 5 ? Math.round(price * 1.2) : price }); // a few real price rises
  }
  assert.equal(checkUnitDrift(products, prev), 1);
  assert.throws(() => checkUnitDrift(products.map((p) => ({ ...p, price: p.price * 10 })), prev), UnitError);
  assert.throws(() => checkUnitDrift(products.map((p) => ({ ...p, price: Math.round(p.price / 10) })), prev), UnitError);
  assert.equal(checkUnitDrift(products.slice(0, 10), prev), null, 'too few products to judge');
});
