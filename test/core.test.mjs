import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCategoriesPage, StructureError } from '../src/rsc.mjs';
import { normalize } from '../src/normalize.mjs';
import { checkProduct } from '../src/sanity.mjs';

const fixture = 'explore/output/bodies/0178.rsc.txt'; // logged-in /categories page 1 from phase 1

test('parses logged-in categories page', { skip: !fs.existsSync(fixture) }, () => {
  const r = parseCategoriesPage(fs.readFileSync(fixture, 'utf8'));
  assert.equal(r.total, 226);
  assert.equal(r.products.length, 19);
  const { product: p, fallbacks } = normalize(r.products[0], { page: 1 });
  assert.deepEqual(fallbacks, []);
  assert.equal(p.id, 547);
  assert.equal(p.price, 9770000);
  assert.equal(p.cost_price, 9379200);
  assert.equal(p.stock, 303);
  assert.ok(p.name.length > 3);
});

test('structure change throws instead of returning empty data', () => {
  assert.throws(() => parseCategoriesPage('<html>new layout</html>'), StructureError);
});

test('sanity check', () => {
  const ok = { price: 1000, cost_price: 960, stock: 5 };
  assert.deepEqual(checkProduct(ok, undefined), []);
  assert.deepEqual(checkProduct(ok, { price: 800, cost_price: 768 }), []);
  assert.match(checkProduct(ok, { price: 600, cost_price: 960 })[0], /price jumped 67%/);
  assert.match(checkProduct({ ...ok, price: 0 }, undefined)[0], /price is empty/);
  assert.match(checkProduct({ ...ok, cost_price: null }, undefined)[0], /cost_price is empty/);
});

test('excluded categories are not sellable, overrides win', async () => {
  const { isSellable } = await import('../src/normalize.mjs');
  const { config } = await import('../src/config.mjs');
  assert.equal(isSellable(497, [199]), false);
  assert.equal(isSellable(367, [199, 124]), false);
  assert.equal(isSellable(394, [131, 172]), true);
  config.sellableOverrides.push(477);
  assert.equal(isSellable(477, [199]), true);
  config.sellableOverrides.pop();
});

const base = { code: 1, title: 'x', category_codes: [10], pricing: { price: 1000, payable_price: 960 }, inventory: { total_inventory: 5 } };

test('fallback paths are used and reported', () => {
  const raw = { code: 2, name: 'y', price: 2000, payable_price: 1900, stock: 7 };
  const { product, fallbacks } = normalize(raw, { page: 3 });
  assert.equal(product.price, 2000);
  assert.equal(product.cost_price, 1900);
  assert.equal(product.stock, 7);
  assert.deepEqual(fallbacks.map((f) => f.field).sort(), ['cost_price', 'name', 'price', 'stock']);
});

test('missing field on every path stops with a precise message', () => {
  const raw = { ...base, pricing: { payable_price: 960 } };
  delete raw.price;
  assert.throws(() => normalize(raw, { page: 3 }), (e) => e instanceof StructureError && /فیلد قیمت پیدا نشد در صفحه‌ی 3، محصول 1/.test(e.message));
});

test('field present but null is passed to sanity check, not a structure error', () => {
  const { product } = normalize({ ...base, pricing: { price: null, payable_price: 960 } });
  assert.equal(product.price, null);
  assert.match(checkProduct(product, undefined)[0], /price is empty/);
});

test('logged-out list (pricing:null) is still recognised as a product list', () => {
  const text = `"products":[{"code":1,"price":5,"pricing":null}],"total":1,"current":1`;
  assert.equal(parseCategoriesPage(text, 1).products.length, 1);
});

test('category tree is read from nested and flat shapes, products are ignored', async () => {
  const { parseCategories, categoryLabel } = await import('../src/categories.mjs');
  const text = `"categories":[{"code":199,"title":"ابزارها و سمپل فروش","children":[{"code":124,"title":"  "},{"code":125,"title":"تستر"}]},` +
    `{"code":131,"name":"آرایشی","parent_code":null}],"products":[{"code":547,"title":"پرفیوم","pricing":{"price":1},"category_codes":[131]}]`;
  const cats = parseCategories(text);
  assert.deepEqual(cats.get(199), { code: 199, name: 'ابزارها و سمپل فروش', parent_code: null });
  assert.equal(cats.get(125).parent_code, 199);
  assert.equal(cats.get(131).name, 'آرایشی');
  assert.equal(cats.has(124), false); // unnamed
  assert.equal(cats.has(547), false); // product, not a category
  assert.equal(categoryLabel(124, cats), '#124');
  assert.equal(parseCategories('<html>no tree</html>').size, 0);
});
