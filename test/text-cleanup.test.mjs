import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, decode, htmlToText, sizeFromText } from '../src/product-details.mjs';

const ZWNJ = '‌';

test('entities: the common named and numeric ones are decoded, also when encoded twice', () => {
  assert.equal(decode('a&nbsp;b &amp; &quot;c&quot; &#1587;&#x644;'), 'a b & "c" سل');
  assert.equal(decode('می&zwnj;شود'), `می${ZWNJ}شود`);
  assert.equal(decode('می&amp;zwnj;شود'), `می${ZWNJ}شود`);
  // the supplier's editor puts &not; / &shy; where a ZWNJ belongs
  assert.equal(decode('می&not;سازد'), `می${ZWNJ}سازد`);
  assert.equal(decode('&bull; یک &middot; دو &hellip; &ndash; Arp&egrave;ge d&rsquo;Eclat'), '• یک · دو … – Arpège d’Eclat');
  assert.equal(decode('&lrm;سلام&rlm;'), 'سلام');
});

test('entities: unknown ones and broken code points never show raw', () => {
  assert.equal(decode('x&foobar;y'), 'xy');
  assert.equal(decode('x&#0;y&#xD800;z&#99999999;'), 'xyz');
  assert.doesNotMatch(cleanText('سلام&weird;&#xZZ; دنیا') ?? '', /&[a-z]+;/i);
});

test('entities: markup that appears only after decoding is removed (no XSS through &lt;script&gt;)', () => {
  assert.equal(decode('&lt;script&gt;alert(1)&lt;/script&gt;سلام'), 'alert(1)سلام');
  assert.equal(decode('&amp;lt;img src=x onerror=alert(1)&amp;gt;متن'), 'متن');
  assert.equal(cleanText('&lt;b onclick="x()"&gt;سلام&lt;/b&gt;'), 'سلام');
  const html = htmlToText('<p>&lt;iframe src="javascript:alert(1)"&gt;&lt;/iframe&gt;متن &amp; بیشتر</p>');
  assert.equal(html, 'متن & بیشتر');
  assert.doesNotMatch(html, /<|javascript:/);
  // a lone «<» in normal text is not a tag
  assert.equal(decode('pH &lt; 5'), 'pH < 5');
});

test('size from text: real names and spec rows', () => {
  const cases = [
    ['بادی میست مردانه تراست مدل Aquamist با حجم 100 میل', { value: 100, unit: 'ml' }],
    ['خمیر دندان توتال گرین برند لایف گارد با حجم 100 گرم', { value: 100, unit: 'g' }],
    ['دهانشویه بزرگسال توتال (Gold Guard) برند لایف گارد با حجم 270 میلی لیتر', { value: 270, unit: 'ml' }],
    ['شامپو ۲۵۰ میلی‌لیتر', { value: 250, unit: 'ml' }],
    ['ژل شستشو 1 لیتری', { value: 1000, unit: 'ml' }],
    ['صابون 100 گرمی', { value: 100, unit: 'g' }],
    ['کرم گرمایی 20 عدد', null],
    ['ژل شستشو 1 لیتر', { value: 1000, unit: 'ml' }],
    ['ژل شستشو 1.5 لیتر', { value: 1500, unit: 'ml' }],
    ['کرم 50ml', { value: 50, unit: 'ml' }],
    ['صابون 75gr', { value: 75, unit: 'g' }],
    ['پودر ۰٫۵ کیلوگرم', { value: 500, unit: 'g' }],
  ];
  for (const [name, want] of cases) assert.deepEqual(sizeFromText(name), want, name);
  assert.deepEqual(sizeFromText('ریمل حجم دهنده سرژه', [{ key: 'حجم', value: '15 میل' }]), { value: 15, unit: 'ml' });
  assert.deepEqual(sizeFromText('x', [{ key: 'حجم محصول', value: '10 میلی لیتر' }]), { value: 10, unit: 'ml' });
});

test('size from text: no unit, a percentage, a shade number or a set is not a size', () => {
  for (const name of [
    'سرم لایه‌بردار قوی تراست حاوی 20% AHA',
    'کرم ضد آفتاب ۵۰ درصد',
    'کرم ضد آفتاب SPF 50',
    'بی بی کرم پلاس تراست شماره 1 (بژ روشن)',
    'رژ لب مایع مخملی مات سرژه کد 101 (Classic Red)',
    'ست مراقبت مو 3 عددی',
    'ست شامپو و نرم کننده 250 میل',
    'ویتامین B12',
    'ریمل حجم دهنده سرژه',
  ]) assert.equal(sizeFromText(name), null, name);
  // a size row that only describes («حجم دهنده مژه») is not a size either
  assert.equal(sizeFromText('ریمل', [{ key: 'مزایا', value: 'حجم 2 برابر' }]), null);
});
