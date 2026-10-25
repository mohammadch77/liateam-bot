// The listing price filter's input parsing (src/lib/price-range.ts). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_FILTER, formatPriceInput, parsePrice, priceRange } from '../../src/lib/price-range.ts';

test('Persian, Arabic-Indic and Latin digits, with or without separators', () => {
  for (const s of ['۱٬۲۵۰٬۰۰۰', '1,250,000', '۱۲۵۰۰۰۰', '١٬٢٥٠٬٠٠٠', '1 250 000', '1.250.000', 1250000])
    assert.equal(parsePrice(s), 1_250_000, String(s));
});

test('empty, words, negatives, fractions and absurd amounts are ignored', () => {
  for (const s of ['', '  ', 'abc', '-5000', '12e5', '1250000.5x', '99999999999', null, undefined, {}])
    assert.equal(parsePrice(s), undefined, String(s));
});

test('the bounds themselves are accepted', () => {
  assert.equal(parsePrice('0'), 0);
  assert.equal(parsePrice(String(PRICE_FILTER.max)), PRICE_FILTER.max);
  assert.equal(parsePrice(String(PRICE_FILTER.max + 1)), undefined);
});

test('a range given the wrong way round is swapped; 0 as the lower end means no lower end', () => {
  assert.deepEqual(priceRange('۹۰۰٬۰۰۰', '۱۰۰٬۰۰۰'), { min: 100_000, max: 900_000 });
  assert.deepEqual(priceRange('0', '500000'), { min: undefined, max: 500_000 });
  assert.deepEqual(priceRange('x', ''), { min: undefined, max: undefined });
  assert.deepEqual(priceRange('500000', '500000'), { min: 500_000, max: 500_000 });
});

test('formatted for an input in Persian digits with separators', () => {
  assert.equal(formatPriceInput(1_250_000), '۱٬۲۵۰٬۰۰۰');
  assert.equal(formatPriceInput(undefined), '');
});
