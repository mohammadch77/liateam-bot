// Search text rules, pure (task N): the normalisation (Persian / Arabic letters and digits, spaces and half-spaces, Latin case), the query
// words, and how a category's or a brand's name is ranked against a query. The products' ranking is SQL (checked by
// `npm run check:search` against the database with a list of real questions). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight, normalizeSearch, searchWords } from '../../src/lib/search/normalize.ts';
import { matchRank, type RankTerms } from '../../src/lib/search/rank.ts';

test('Arabic letters and digits become the Persian ones; case, spaces and half-spaces are one thing', () => {
  assert.equal(normalizeSearch('كانسيلر'), 'کانسیلر');
  assert.equal(normalizeSearch('ريمل'), 'ریمل');
  assert.equal(normalizeSearch('آرایشی'), 'ارایشی'); // آ and ا are the same to a search
  assert.equal(normalizeSearch('۱۵ ميل'), '15 میل');
  assert.equal(normalizeSearch('١٥'), '15');
  assert.equal(normalizeSearch('ضد‌آفتاب'), 'ضد افتاب'); // a half-space is a space
  assert.equal(normalizeSearch('  ضد   آفتاب '), 'ضد افتاب');
  assert.equal(normalizeSearch('SPF50+'), 'spf50');
  assert.equal(normalizeSearch('Trust-Pro'), 'trust pro');
  assert.equal(normalizeSearch('مَژه'), 'مژه'); // the harakat go
  assert.equal(normalizeSearch('بـلند'), 'بلند'); // the tatweel goes
});

test('query words: distinct, at most six, each at most thirty letters; nothing for an empty query', () => {
  assert.deepEqual(searchWords('سرم سرم  ضد‌لک'), ['سرم', 'ضد', 'لک']);
  assert.deepEqual(searchWords(''), []);
  assert.deepEqual(searchWords(undefined), []);
  assert.equal(searchWords('a b c d e f g h').length, 6);
  assert.equal(searchWords('x'.repeat(50))[0]!.length, 30);
});

const terms = (text: string, alts: Record<string, string[]> = {}): RankTerms => ({
  text: normalizeSearch(text),
  words: searchWords(text).map((word) => ({ word, alts: alts[word] ?? [] })),
});

test('names are ranked: the name is the query, starts with it, a word starts with it, contains it; no match is null', () => {
  const t = terms('سرم');
  assert.equal(matchRank('سرم', t), 0);
  assert.equal(matchRank('سرم تخصصی صورت', t), 1);
  assert.equal(matchRank('کرم و سرم', t), 2);
  assert.equal(matchRank('پیشسرمه', t), 3);
  assert.equal(matchRank('ریمل', t), null);
  // Arabic letters in the name or in the query do not matter
  assert.equal(matchRank('ريمل مشكي', terms('ریمل')), 1);
  assert.equal(matchRank('ریمل', terms('ريمل')), 0);
});

test('every word of the query must be in the name; a spelling correction counts as the word', () => {
  assert.equal(matchRank('کرم ضد آفتاب', terms('ضد آفتاب')), 2);
  assert.equal(matchRank('کرم آفتاب', terms('ضد آفتاب')), null);
  assert.equal(matchRank('ضد‌آفتاب', terms('ضد آفتاب')), 0); // the half-space is a space
  assert.equal(matchRank('ریمل حجم دهنده', terms('رمل', { رمل: ['ریمل'] })), 1);
  assert.equal(matchRank('ریمل حجم دهنده', terms('رمل')), null);
  assert.equal(matchRank('anything', { text: '', words: [] }), null);
});

test('the matched part of a text is found in its normalised form (the highlight)', () => {
  const marked = highlight('ریمل مشکی', ['ریمل']).filter((x) => x.hit).map((x) => x.text);
  assert.deepEqual(marked, ['ریمل']);
  assert.deepEqual(highlight('آرایشی', ['ارایشی']).filter((x) => x.hit).map((x) => x.text), ['آرایشی']);
});
