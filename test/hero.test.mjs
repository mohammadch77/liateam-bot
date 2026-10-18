import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heroHash, parseHeroSlides, slideTarget } from '../src/hero.mjs';
import { saveHeroSlides } from '../src/db.mjs';

// Fixture: the «sliders» list of Liateam's home page (2026-10-17), staff usernames removed.
const home = fs.readFileSync(new URL('./fixtures/home/home.rsc.txt', import.meta.url), 'utf8');
const wrap = (sliders) => `x:["$","$L12",null,${JSON.stringify({ sliders })}]`;
const slide = (o) => ({ code: 1, type: 'main', status: 'active', priority: 1, link: 'https://liateam.ir/products/1',
  image: 'https://s3.liateam.ir/themis/public/slider/image/1.jpg', ...o });

test('fixture: 14 linkable slides in priority order, promotion and "#" skipped', () => {
  const r = parseHeroSlides(home);
  assert.equal(r.found, true);
  assert.equal(r.slides.length, 14);
  assert.deepEqual(r.slides.slice(0, 3).map((s) => [s.target_type, s.target_code]),
    [['product', 314], ['product', 553], ['product', 547]]);
  assert.deepEqual(r.slides.at(-1), {
    source_code: 582, image_url: 'https://s3.liateam.ir/themis/public/slider/image/92004-1781434983.jpg',
    portrait_url: 'https://s3.liateam.ir/themis/public/slider/portrait-image/58000-1781434983.jpg',
    color: '#244f77', alt: 'رژ لب های براق', target_type: 'category', target_code: 173,
  });
  assert.deepEqual(r.skipped.map((s) => [s.source_code, s.reason]), [[653, 'no-page'], [626, 'no-link']]);
  assert.ok(r.slides.every((s) => s.image_url.startsWith('https://s3.liateam.ir/')));
});

test('order follows priority, not the order in the payload', () => {
  const r = parseHeroSlides(wrap([
    slide({ code: 2, priority: 9, link: '/products/22', image: 'https://s3.liateam.ir/a/2.jpg' }),
    slide({ code: 1, priority: 3, link: '/products/11', image: 'https://s3.liateam.ir/a/1.jpg' }),
  ]));
  assert.deepEqual(r.slides.map((s) => s.target_code), [11, 22]);
});

test('destination mapping: product, category, sub-category, case-insensitive scheme; others skipped', () => {
  assert.deepEqual(slideTarget('https://liateam.ir/products/314'), { type: 'product', code: 314 });
  assert.deepEqual(slideTarget('Https://LIATEAM.ir/products/314/'), { type: 'product', code: 314 });
  assert.deepEqual(slideTarget('https://liateam.ir/categories/173'), { type: 'category', code: 173 });
  assert.deepEqual(slideTarget('https://liateam.ir/categories/150/sub/153'), { type: 'category', code: 153 });
  assert.deepEqual(slideTarget('https://liateam.ir/promotions/1641'), { skip: 'no-page' });
  assert.deepEqual(slideTarget('#'), { skip: 'no-link' });
  assert.deepEqual(slideTarget(''), { skip: 'no-link' });
  assert.deepEqual(slideTarget('https://evil.example/products/1'), { skip: 'external' });
  assert.deepEqual(slideTarget('javascript:alert(1)'), { skip: 'external' });
});

test('photos only from Liateam\'s image host; bad portrait dropped, bad main photo skips the slide', () => {
  const r = parseHeroSlides(wrap([
    slide({ code: 1, image: 'https://cdn.example.com/x.jpg' }),
    slide({ code: 2, image: 'https://s3.liateam.ir/a/2.jpg', portrait_image: 'http://s3.liateam.ir/a/p.jpg', color: 'red' }),
    slide({ code: 3, status: 'inactive', image: 'https://s3.liateam.ir/a/3.jpg' }),
  ]));
  assert.deepEqual(r.skipped.map((s) => [s.source_code, s.reason]), [[1, 'bad-image']]);
  assert.equal(r.slides.length, 1);
  assert.equal(r.slides[0].portrait_url, null);
  assert.equal(r.slides[0].color, null);
});

test('no slider list = found:false (layout changed: keep the stored slides)', () => {
  assert.deepEqual(parseHeroSlides('{"products":[]}'), { found: false });
});

test('hash changes with order or destination, not otherwise', () => {
  const { slides } = parseHeroSlides(home);
  assert.equal(heroHash(slides), heroHash(parseHeroSlides(home).slides));
  assert.notEqual(heroHash(slides), heroHash([...slides].reverse()));
  assert.notEqual(heroHash(slides), heroHash([{ ...slides[0], target_code: 1 }, ...slides.slice(1)]));
});

// saveHeroSlides against a fake client: unknown targets skipped, rewrite only on change
function fakeDb(products, categories) {
  const state = { status: null, rows: [], writes: 0 };
  return {
    state,
    async query(sql, params = []) {
      if (sql.startsWith('SELECT id FROM supplier_products')) return { rows: params[0].filter((id) => products.includes(id)).map((id) => ({ id })) };
      if (sql.startsWith('SELECT code FROM categories')) return { rows: params[0].filter((c) => categories.includes(c)).map((code) => ({ code })) };
      if (sql.includes("key = 'hero'")) return { rows: state.status ? [{ value: state.status }] : [] };
      if (sql.startsWith('INSERT INTO bot_status')) { state.status = JSON.parse(params[1]); return { rows: [] }; }
      if (sql.startsWith('DELETE FROM hero_slides')) { state.rows = []; state.writes++; return { rows: [] }; }
      if (sql.trim().startsWith('INSERT INTO hero_slides')) { state.rows.push(params); return { rows: [] }; }
      return { rows: [] };
    },
  };
}

test('save: slides to products/categories we do not have are skipped and reported; unchanged = no rewrite', async () => {
  const parsed = parseHeroSlides(home);
  const db = fakeDb([314, 553, 547, 526, 420, 361, 362, 508], [173, 150]); // 506 and category 153 missing
  const r = await saveHeroSlides(db, parsed, heroHash);
  assert.equal(r.changed, true);
  assert.equal(r.slides.length, 12);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ['no-link', 'no-page', 'unknown-category', 'unknown-product']);
  assert.deepEqual(db.state.rows.map((p) => p[0]), [...Array(12).keys()]); // positions 0..11
  assert.equal(db.state.status.count, 12);
  const again = await saveHeroSlides(db, parsed, heroHash);
  assert.equal(again.changed, false);
  assert.equal(db.state.writes, 1);
});
