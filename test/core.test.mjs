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

test('liateam category objects are found wherever they sit (real payload shape)', async () => {
  const { parseCategories } = await import('../src/categories.mjs');
  const text = `0:{"x":"$L1"} 5:["$","div",null,{"data":[{"id":"aa-1","code":131,"type":"product","title":"ماسک تخصصی","alt_banner_image":"ماسک","parent_code":null},` +
    `{"id":"f51f248c-39c2-4617-9a38-743f4921e2d2","code":151,"type":"product","title":"عطر","image":"https://x/a.png","alt_image":"عطر ، خوشبوکننده","parent_code":131}]}]` +
    ` 7:{"products":[{"id":"c28c","code":547,"product_code":547,"title":"پرفیوم","category_codes":[151],"pricing":{"id":"p1","code":547,"price":9770000}}],"total":1}`;
  const cats = parseCategories(text);
  assert.deepEqual(cats.get(151), { code: 151, name: 'عطر', parent_code: 131 });
  assert.equal(cats.get(131).name, 'ماسک تخصصی');
  assert.equal(cats.has(547), false);
});

test('catalog diff: new, price, stock, removed, returned; none on first run', async () => {
  const { diffCatalog } = await import('../src/db.mjs');
  const prev = new Map([
    [1, { id: 1, name: 'a', price: '1000', cost_price: '900', stock: 5, missing_since: null }],
    [2, { id: 2, name: 'b', price: '2000', cost_price: '1800', stock: 0, missing_since: null }],
    [3, { id: 3, name: 'c', price: '3000', cost_price: '2700', stock: 1, missing_since: null }],
    [4, { id: 4, name: 'd', price: '4000', cost_price: '3600', stock: 1, missing_since: new Date() }],
  ]);
  const accepted = [
    { id: 1, name: 'a', price: 1100, cost_price: 900, stock: 0 },
    { id: 2, name: 'b', price: 2000, cost_price: 1800, stock: 7 },
    { id: 4, name: 'd', price: 4000, cost_price: 3600, stock: 1 },
    { id: 5, name: 'e', price: 500, cost_price: 450, stock: 3 },
  ];
  const ev = diffCatalog(prev, accepted, new Set([1, 2, 4, 5]));
  const kinds = ev.map((e) => `${e.product_id}:${e.kind}`).sort();
  assert.deepEqual(kinds, ['1:out_of_stock', '1:price', '2:back_in_stock', '3:removed', '4:returned', '5:new']);
  assert.deepEqual(diffCatalog(new Map(), accepted, new Set([1])), []);
});

test('image url is picked from the first http path, absence is fine', async () => {
  const { normalize } = await import('../src/normalize.mjs');
  const base = { code: 9, title: 'x', pricing: { price: 1, payable_price: 1 }, inventory: { total_inventory: 1 } };
  assert.equal(normalize({ ...base, home_page_image: 'https://s3.liateam.ir/a.png' }).product.image_url, 'https://s3.liateam.ir/a.png');
  assert.equal(normalize({ ...base, image: 'not-a-url' }).product.image_url, null);
});

test('api login session state is a lia-token cookie with the server expiry', async () => {
  const { sessionState } = await import('../src/auth.mjs');
  const st = sessionState('abc', '2027-11-12T10:00:00+03:30');
  assert.equal(st.cookies[0].name, 'lia-token');
  assert.equal(st.cookies[0].domain, 'liateam.ir');
  assert.equal(st.cookies[0].expires, Math.floor(Date.parse('2027-11-12T10:00:00+03:30') / 1000));
  assert.equal(sessionState('abc', 'garbage').cookies[0].expires, -1);
});
