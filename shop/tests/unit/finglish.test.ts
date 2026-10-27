// Category slugs (src/lib/finglish.ts + categoryPath in src/lib/urls.ts): dictionary first, then letter-by-letter
// transliteration; lower-case a-z0-9 and single hyphens; the numeric code always last and the only thing that finds a
// category. Real category names are the ones the sync bot stores today. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { finglish } from '../../src/lib/finglish.ts';
import { categoryPath, idFromSlug } from '../../src/lib/urls.ts';

test('the examples: ماسک مو, ماسک صورت', () => {
  assert.equal(finglish('ماسک مو'), 'mask-moo');
  assert.equal(finglish('ماسک صورت'), 'mask-soorat');
  assert.equal(categoryPath(179, 'ماسک مو'), '/shop/category/mask-moo-179');
  assert.equal(categoryPath(180, 'ماسک صورت'), '/shop/category/mask-soorat-180');
});

test('real categories: dictionary words, Arabic letter variants, ZWNJ, Latin letters, digits', () => {
  const real: Array<[string, string]> = [
    ['کرم تخصصی صورت', 'krem-takhasosi-soorat'],
    ['شامپو تخصصی', 'shampoo-takhasosi'],
    ['روغن مو', 'roghan-moo'],
    ['ضد آفتاب', 'zed-aftab'],
    ['CC کرم', 'cc-krem'],
    ['خمیر دندان', 'khamir-dandan'],
    ['عطر و خوشبوکننده', 'attar-va-khoshbo-konande'],
    ['ابزارها و سمپل ها', 'abzarha-va-sample-ha'],
    ['روغن ، لوسیون', 'roghan-lotion'],
    ['ناحیه چشم', 'nahiye-cheshm'],
  ];
  for (const [fa, en] of real) assert.equal(finglish(fa), en, fa);
  assert.equal(finglish('ماسك مو'), 'mask-moo'); // Arabic kaf
  assert.equal(finglish('رنگي'), 'rangi'); // Arabic yeh
  assert.equal(finglish('کانسیلر ۲'), 'concealer-2'); // Persian digit
});

test('a word outside the dictionary is transliterated; the result is always a-z0-9 and single hyphens', () => {
  assert.equal(finglish('پروبیوتیک'), 'probiotik');
  for (const name of ['پروبیوتیک', 'بخور  و  عود!', '٣ در ١', 'a_b  c', 'ـــ', '', '  ']) {
    const s = finglish(name);
    assert.match(s, /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/, `${name} → ${s}`);
  }
  assert.equal(finglish(''), '');
  assert.equal(finglish('؟؟'), '');
  assert.equal(finglish('ماسک   مو'), finglish('ماسک مو')); // deterministic, spacing-independent
});

test('two categories with the same name differ by the code; the code is read from the end', () => {
  const a = categoryPath(157, 'بدن');
  const b = categoryPath(162, 'بدن');
  assert.equal(a, '/shop/category/badan-157');
  assert.equal(b, '/shop/category/badan-162');
  assert.notEqual(a, b);
  assert.equal(idFromSlug('badan-157'), 157);
});

test('a renamed category or wrong words still resolve by the code (the caller redirects to the canonical address)', () => {
  assert.equal(idFromSlug('mask-moo-179'), 179);
  assert.equal(idFromSlug('some-old-name-179'), 179);
  assert.equal(idFromSlug('179-ماسک-مو'), 179); // the old Persian address
  assert.equal(idFromSlug(encodeURIComponent('179-ماسک-مو')), 179);
  assert.equal(idFromSlug('179'), 179);
  // renamed: the canonical path changes with the name, the code stays
  assert.equal(categoryPath(179, 'ماسک موی خشک'), '/shop/category/mask-mooye-khoshk-179');
});
