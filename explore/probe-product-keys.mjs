// Lists the keys of the product object in a saved product page payload and previews their values.
// Usage: node explore/probe-product-keys.mjs explore/output/product-541.rsc.txt
import fs from 'node:fs';
import { scanValue } from '../src/rsc.mjs';

const text = fs.readFileSync(process.argv[2], 'utf8');
const at = text.indexOf('"brand":{"code"');
// walk back to the nearest '{' whose object holds both brand and categories (= the product)
let product = null;
for (let i = at; i >= 0 && !product; i--) {
  if (text[i] !== '{') continue;
  try {
    const v = JSON.parse(text.slice(i, scanValue(text, i)));
    if (v && v.brand && v.categories) product = v;
  } catch {
    /* not a complete JSON object */
  }
}
if (!product) throw new Error('product object not found');
for (const [k, v] of Object.entries(product)) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  console.log(k.padEnd(26), String(s).replace(/\s+/g, ' ').slice(0, 150));
}
