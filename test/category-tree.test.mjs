// Liateam's official category tree is read from the `product/categories` query embedded in its pages; its array
// order is the site menu's order and must be kept as `position`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialTree } from '../src/categories.mjs';

const cat = (code, title, parent_code, type = 'product') =>
  ({ id: `uuid-${code}`, code, type, title, image: 'x.jpg', alt_image: title, parent_code });
const payload = (data) =>
  `…"queryKey":["profile/profile"]},{"dehydratedAt":1,"state":{"data":${JSON.stringify(data)},"dataUpdateCount":1,` +
  `"status":"success"},"queryKey":["product/categories"],"queryHash":"x"},{"state":{"data":[{"code":18,"title":"سرژه"}]},"queryKey":["brands"]}`;

test('keeps Liateam order, parents and type; collapses doubled spaces', () => {
  const tree = parseOfficialTree(payload([
    cat(150, 'عطر و خوشبوکننده', null),
    cat(154, 'سرم  تخصصی', null),
    cat(151, 'عطر', 150),
    cat(163, 'ابزارها و سمپل ها', null, 'accessory'),
    cat(152, 'بادی میست', 150),
  ]));
  assert.deepEqual(tree.map((c) => [c.code, c.name, c.parent_code, c.position, c.type]), [
    [150, 'عطر و خوشبوکننده', null, 0, 'product'],
    [154, 'سرم تخصصی', null, 1, 'product'],
    [151, 'عطر', 150, 2, 'product'],
    [163, 'ابزارها و سمپل ها', null, 3, 'accessory'],
    [152, 'بادی میست', 150, 4, 'product'],
  ]);
});

test('does not pick up other queries (brands) or guess when the tree is missing', () => {
  assert.equal(parseOfficialTree('{"state":{"data":[{"code":18,"title":"سرژه"}]},"queryKey":["brands"]}'), null);
  assert.equal(parseOfficialTree(payload([])), null);
});
