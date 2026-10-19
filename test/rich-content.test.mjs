import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanText, maskAuthor, parseBrands, parseProductDetails, parseVideo, sectionHashes } from '../src/product-details.mjs';
import { KNOWN_BRAND_LATIN, englishSlug, persianSlug, transliterate } from '../src/slug.mjs';

// Fixtures: real product pages (2026-10-17) reduced to the product object, its description row, the first
// reviews (customer names replaced) and the brand list. The pricing block is kept on purpose: nothing parsed
// from it may reach the rich sections.
const page = (id) => fs.readFileSync(new URL(`./fixtures/pdp/${id}.rsc.txt`, import.meta.url), 'utf8');
const parse = (id) => parseProductDetails(page(id), id);

test('301: every section present — summary, features, specs, how-to-use, video, FAQ, reviews', () => {
  const r = parse(301);
  assert.equal(r.found, true);
  assert.equal(r.brand, 'تراست پرو');
  assert.ok(r.description.length > 100);
  const x = r.rich;
  assert.equal(x.summary.split('\n').length, 5);
  assert.deepEqual(x.features.slice(0, 2), ['تحریک و افزایش رشد مژه', 'افزایش ضخامت و طول مژه']);
  assert.equal(x.attributes.length, 11);
  assert.ok(x.attributes.every((a) => a.key && a.value));
  assert.match(x.howToUse, /امتداد خط رویش مژه/);
  assert.match(x.video.url, /^https:\/\/liateam\.arvanvod\.ir\/.+\.mp4$/);
  assert.match(x.video.embed, /^https:\/\/player\.arvancloud\.ir\/index\.html\?config=/);
  assert.ok(x.faqs.length >= 2);
  assert.deepEqual(x.faqs[0], {
    question: 'خانم‌های باردار، به خاطر داشتن چه ماده‌ای، نباید از سرم مژه استفاده کنند؟',
    answer: 'بیماتوپراست',
  });
  assert.equal(x.reviews.length, 6);
  assert.equal(x.total, 231);
  assert.equal(x.reviews[0].author, 'مریم ا.');
  assert.ok(x.reviews.some((v) => v.reply)); // Liateam's answer kept
  assert.ok(x.reviews.every((v) => v.rating === null || (v.rating >= 1 && v.rating <= 10)));
  assert.ok(x.reviews.every((v) => !Number.isNaN(Date.parse(v.created_at))));
  assert.equal(x.brandCode, 14);
  assert.ok(x.rating >= 0 && x.rating <= 100);
});

test('541: no summary, no FAQ, no video → null / empty, not an error', () => {
  const x = parse(541).rich;
  assert.equal(x.summary, null);
  assert.equal(x.video, null);
  assert.deepEqual(x.faqs, []);
  assert.equal(x.attributes.length, 8);
  assert.equal(x.features.length, 6);
  assert.equal(x.total, 9);
});

test('526: a content-bank page in video_link is dropped, the ArvanCloud player is kept', () => {
  const x = parse(526).rich;
  assert.equal(x.video.url, null);
  assert.match(x.video.embed, /^https:\/\/player\.arvancloud\.ir\//);
});

test('372: "." placeholder how-to-use → null; product without reviews', () => {
  const x = parse(372).rich;
  assert.equal(x.howToUse, null);
  assert.deepEqual(x.reviews, []);
  assert.equal(x.total, 0);
});

test('no price of any kind leaks into the rich sections', () => {
  for (const id of [301, 541, 526, 372]) {
    const json = JSON.stringify(parse(id).rich);
    assert.doesNotMatch(json, /price|payable|pricing|discount/i);
    const pricing = JSON.parse(/"pricing":(\{.*?"payable_price":\d+)/.exec(page(id))[1] + '}');
    assert.ok(!json.includes(String(pricing.payable_price)), `${id}: payable_price value found`);
  }
});

test('brand list mirrored in Liateam order', () => {
  const brands = parseBrands(page(301));
  assert.equal(brands.length, 7);
  assert.deepEqual(brands[0], { code: 18, name: 'سرژه', latin: null, image: brands[0].image, position: 0,
    banner: brands[0].banner, bannerPortrait: brands[0].bannerPortrait });
  assert.match(brands[0].image, /^https:\/\/s3\.liateam\.ir\//);
  assert.ok(brands.every((b) => b.name in KNOWN_BRAND_LATIN));
});

test('sanitiser: no markup, scripts or foreign video survive', () => {
  assert.equal(cleanText('<b onclick="x()">سلام</b><script>alert(1)</script>'), 'سلامalert(1)');
  assert.equal(cleanText('<img src=x onerror=alert(1)>'), null);
  assert.equal(cleanText(' - '), null);
  assert.equal(parseVideo('https://evil.example/v.mp4', '<iframe src="https://evil.example/p"></iframe>'), null);
  assert.equal(parseVideo('javascript:alert(1)', null), null);
  assert.equal(maskAuthor('گشسب بانو علی زاده'), 'گشسب ز.');
  assert.equal(maskAuthor('  '), null);
});

test('section hashes: same page → same hashes; one changed section → only its hash changes', () => {
  const a = parse(301).rich;
  assert.deepEqual(sectionHashes(a), sectionHashes(parse(301).rich));
  const b = { ...a, faqs: [...a.faqs, { question: 'q', answer: 'a' }] };
  const changed = Object.keys(sectionHashes(a)).filter((k) => sectionHashes(a)[k] !== sectionHashes(b)[k]);
  assert.deepEqual(changed, ['faqs']);
});

test('English slug: ASCII, brand first, ends with the code, stable', () => {
  const s = englishSlug({ code: 541, name: 'ریمل ابرو قهوه ای تیره سرژه (حالت دهنده)', brandLatin: 'Serge' });
  assert.match(s, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(s.startsWith('serge-') && s.endsWith('-541'));
  assert.equal(s, englishSlug({ code: 541, name: 'ریمل ابرو قهوه ای تیره سرژه (حالت دهنده)', brandLatin: 'Serge' }));
  assert.equal(englishSlug({ code: 7, name: '', brandLatin: null }), '7');
  assert.ok(englishSlug({ code: 9, name: 'کلمه '.repeat(60), brandLatin: 'Trust Pro' }).length <= 90);
  assert.equal(transliterate('شامپو ۲ در ۱'), 'shampo-2-dr-1');
  assert.equal(persianSlug('کرم آب‌رسان (پوست خشک)'), 'کرم-آب-رسان-پوست-خشک');
});

test('English slugs are unique across the whole catalog (the code makes them so)', () => {
  // same name, same brand, different products → different slugs
  const names = ['کرم دست', 'کرم دست', 'کرم  دست', 'كرم دست'];
  const slugs = names.map((name, i) => englishSlug({ code: 100 + i, name, brandLatin: 'Trust Pro' }));
  assert.equal(new Set(slugs).size, slugs.length);
});

test('gallery: extra photos in Liateam order, own image host only, main photo not repeated', () => {
  const raw = (id) => JSON.parse(/"productData":(\{.*?\}),"pagination"/s.exec(page(id))[1]);
  for (const [id, n] of [[541, 5], [301, 4], [372, 2]]) {
    const g = parse(id).rich.gallery;
    const src = raw(id).gallery_images.map((x) => x.image);
    assert.equal(g.length, n, `${id}`);
    assert.deepEqual(g.map((x) => x.url), src, `${id}: order kept`);
    assert.ok(g.every((x) => x.url.startsWith('https://s3.liateam.ir/')));
  }
});

test('gallery: foreign hosts, scripts, duplicates and the main photo are dropped', async () => {
  const { parseGallery } = await import('../src/product-details.mjs');
  const main = 'https://s3.liateam.ir/lamia/public/product_group/home_page/1.png';
  const g = parseGallery({
    home_page_image: main,
    gallery_images: [
      { image: main },
      { image: 'https://s3.liateam.ir/lamia/public/product_group/gallery_image/2.png', alt_image: '<b>عکس</b> دو' },
      { image: 'https://evil.example/x.png' },
      { image: 'javascript:alert(1)' },
      { image: 'https://s3.liateam.ir/lamia/public/product_group/gallery_image/2.png' },
      { image: 'http://s3.liateam.ir/lamia/public/product_group/gallery_image/3.png' },
      null,
    ],
  });
  assert.deepEqual(g, [{ url: 'https://s3.liateam.ir/lamia/public/product_group/gallery_image/2.png', alt: 'عکس دو' }]);
  assert.deepEqual(parseGallery({ home_page_image: main }), []); // single photo → no gallery
});

test('gallery hash: changes only when the photos change', () => {
  const a = parse(541).rich;
  const b = { ...a, gallery: [...a.gallery].reverse() };
  const changed = Object.keys(sectionHashes(a)).filter((k) => sectionHashes(a)[k] !== sectionHashes(b)[k]);
  assert.deepEqual(changed, ['gallery']);
});

test('facts: size, colour (alpha byte dropped), shelf life and meta texts from the product object', () => {
  const x = parse(301).rich;
  assert.deepEqual(x.measurement, { value: 10, unit: 'ml' });
  assert.equal(x.color, '#f0eaf1');
  assert.equal(x.expireMonths, 30);
  assert.equal(x.metaTitle, 'سرم تقویت مژه تراست');
  assert.deepEqual(x.tags, [{ code: 2, key: 'best-selling', title: 'best-selling' }]);
  assert.deepEqual(parse(372).rich.measurement, { value: 50, unit: 'g' }); // "gr" → g
  assert.equal(parse(526).rich.expireMonths, 24);
});

test('facts: junk values are dropped, never guessed', async () => {
  const { parseMeasurement, parseColor } = await import('../src/product-details.mjs');
  assert.deepEqual(parseMeasurement('15', 'ml'), { value: 15, unit: 'ml' });
  assert.equal(parseMeasurement(0, 'ml'), null);
  assert.equal(parseMeasurement('abc', 'ml'), null);
  assert.equal(parseMeasurement(10, 'liter'), null);
  assert.equal(parseColor('#EBEBEB'), '#ebebeb');
  assert.equal(parseColor('red'), null);
  assert.equal(parseColor('#12345'), null);
  assert.equal(parseColor('url(javascript:x)'), null);
});

test('concerns: order kept, markup removed, duplicates dropped, pictures only from Liateam', async () => {
  const { parseConcerns, parseTags } = await import('../src/product-details.mjs');
  const c = parseConcerns([
    { code: 79, title: 'ریزش مو', image: null },
    { code: 85, title: '<b>نازکی</b> مو', image: 'https://s3.liateam.ir/lamia/public/concern/image/1.png' },
    { code: 86, title: 'ریزش مو' },
    { code: 87, title: 'x', image: 'https://evil.example/a.png' },
    null,
  ]);
  assert.deepEqual(c, [
    { code: 79, title: 'ریزش مو', image_url: null },
    { code: 85, title: 'نازکی مو', image_url: 'https://s3.liateam.ir/lamia/public/concern/image/1.png' },
    { code: 87, title: 'x', image_url: null },
  ]);
  assert.deepEqual(parseTags([{ code: 1, key: 'newest', title: 'newest' }, {}]), [{ code: 1, key: 'newest', title: 'newest' }]);
});

test('facts / concerns / tags have their own hashes', () => {
  const a = parse(301).rich;
  const b = { ...a, color: '#000000', concerns: [{ code: 1, title: 'x', image_url: null }] };
  const changed = Object.keys(sectionHashes(a)).filter((k) => sectionHashes(a)[k] !== sectionHashes(b)[k]);
  assert.deepEqual(changed, ['facts', 'concerns']);
});

test('brands carry their banners (Liateam host only)', () => {
  const b = parseBrands(page(301));
  assert.ok(b.length >= 7);
  assert.ok(b.every((x) => x.banner === null || x.banner.startsWith('https://s3.liateam.ir/')));
  assert.ok(b.some((x) => x.banner && x.bannerPortrait));
});

test('the product page names its brand banners (when the brand list is absent)', () => {
  const x = parse(301).rich;
  assert.match(x.brandBanner, /^https:\/\/s3\.liateam\.ir\/.+banner_image/);
  assert.match(x.brandBannerPortrait, /^https:\/\/s3\.liateam\.ir\/.+banner_portrait_image/);
});
