import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, parseProductDetails } from '../src/product-details.mjs';

// A product page payload in the shape Liateam sends: the long description as a separate RSC text row whose
// length is in UTF-8 BYTES (Persian letters are 2 bytes each).
function payload({ code = 541, brand = { code: 18, title: 'سرژه' }, description = '$23', row } = {}) {
  const product = { id: 'x', code, product_code: code, title: 'ریمل ابرو', description, brand, categories: [{ code: 174 }] };
  const head = `0:["$","div",null,{"product":${JSON.stringify(product)}}]\n`;
  const tail = row ?? '<p><strong>مزایا:</strong></p><ul><li>حجم&shy;دهنده</li><li>ضد آب</li></ul><p>متن&nbsp;اصلی.</p>';
  return `${head}23:T${Buffer.byteLength(tail, 'utf8').toString(16)},${tail}24:["$","p",null,{}]\n`;
}

test('reads brand and resolves the description row by byte length (Persian text)', () => {
  const r = parseProductDetails(payload(), 541);
  assert.equal(r.found, true);
  assert.equal(r.brand, 'سرژه');
  assert.equal(r.description, '## مزایا\n\n• حجم‌دهنده\n• ضد آب\n\nمتن اصلی.');
  assert.deepEqual(r.paths, { brand: 'brand.title', description: 'description' });
});

test('missing description / brand → null, never an error', () => {
  const r = parseProductDetails(payload({ brand: null, description: null }), 541);
  assert.deepEqual({ found: r.found, brand: r.brand, description: r.description }, { found: true, brand: null, description: null });
});

test('another product on the page is not mistaken for this one; absent product → found=false', () => {
  assert.equal(parseProductDetails(payload({ code: 999 }), 541).found, false);
});

test('htmlToText strips markup, scripts and inline styles; keeps structure', () => {
  const html =
    '<p dir="rtl" style="color:red"><span style="font-family:B Mitra">سلام</span></p><script>alert(1)</script>' +
    '<h3>تیتر</h3><p>خط اول<br>خط دوم</p><img src=x onerror=alert(1)>';
  assert.equal(htmlToText(html), 'سلام\n\n## تیتر\n\nخط اول\nخط دوم');
  assert.equal(htmlToText(''), null);
  assert.equal(htmlToText('<p> &nbsp; </p>'), null);
});

test('long descriptions are capped on a word boundary', () => {
  const out = htmlToText(`<p>${'کلمه '.repeat(3000)}</p>`);
  assert.ok(out.length <= 8001 && out.endsWith('…'));
});
