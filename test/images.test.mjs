import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyStatus, resolveImage } from '../src/images.mjs';
import { parseProductDetails } from '../src/product-details.mjs';

// Fixture: product 541's page (main photo + gallery in Liateam's order), as for the gallery tests.
const page = fs.readFileSync(new URL('./fixtures/pdp/541.rsc.txt', import.meta.url), 'utf8');
const gallery = parseProductDetails(page, 541).rich.gallery.map((g) => g.url);
const main = 'https://s3.liateam.ir/lamia/public/product_group/home_page/541.png';

test('HTTP answers: 2xx exists, 404/410/403 gone, anything else unknown (decided later)', () => {
  assert.equal(classifyStatus(200), true);
  assert.equal(classifyStatus(206), true);
  for (const s of [404, 410, 403]) assert.equal(classifyStatus(s), false);
  for (const s of [500, 502, 429, 301]) assert.equal(classifyStatus(s), null);
});

test('main photo kept while it is not known broken (unchecked counts as fine)', () => {
  assert.ok(gallery.length >= 2);
  assert.equal(resolveImage(main, gallery, new Set()), main);
});

test('main photo 404 → the first working gallery photo, in Liateam order (product 426 case)', () => {
  assert.equal(resolveImage(main, gallery, new Set([main])), gallery[0]);
  assert.equal(resolveImage(main, gallery, new Set([main, gallery[0]])), gallery[1]);
  assert.equal(resolveImage(null, gallery, new Set()), gallery[0]);
});

test('no working photo at all → null (the shop draws its placeholder)', () => {
  assert.equal(resolveImage(main, gallery, new Set([main, ...gallery])), null);
  assert.equal(resolveImage(null, [], new Set()), null);
});
