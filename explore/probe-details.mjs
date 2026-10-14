// Runs the details parser on a saved product page. Usage: node explore/probe-details.mjs 541
import fs from 'node:fs';
import { parseProductDetails } from '../src/product-details.mjs';

const code = Number(process.argv[2] ?? 541);
const r = parseProductDetails(fs.readFileSync(`explore/output/product-${code}.rsc.txt`, 'utf8'), code);
console.log({ found: r.found, brand: r.brand, paths: r.paths, chars: r.description?.length });
console.log('----\n' + r.description);
