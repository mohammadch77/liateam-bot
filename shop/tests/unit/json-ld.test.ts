// JSON-LD inside <script type="application/ld+json"> (src/lib/json-ld.ts): text from the catalog can never close the
// block. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonLd } from '../../src/lib/json-ld.ts';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const evil = `کرم </script><img src=x onerror=alert(1)> & «نام» ${LS} ${PS}`;

test('no <, >, & or line separator is left raw', () => {
  const out = jsonLd({ name: evil });
  assert.doesNotMatch(out, /[<>&]/);
  assert.ok(!out.includes(LS) && !out.includes(PS));
  assert.match(out, /\\u2028 \\u2029/);
  assert.doesNotMatch(out, /<\/script/i);
  assert.match(out, /\\u003c\/script\\u003e\\u003cimg/);
});

test('the block stays one script element: the HTML parser sees no early end tag', () => {
  const html = `<script type="application/ld+json">${jsonLd({ name: evil })}</script>`;
  // the first «</script» is the block's own closing tag
  assert.equal(html.toLowerCase().indexOf('</script'), html.length - '</script>'.length);
});

test('the JSON means exactly the same', () => {
  const data = {
    '@type': 'Product',
    name: evil,
    offers: { price: 1490000, priceCurrency: 'IRR' },
    list: [1, 'a&b'],
  };
  assert.deepEqual(JSON.parse(jsonLd(data)), data);
});
