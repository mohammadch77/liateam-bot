// Category tree (code -> name, parent) extracted from the /categories RSC payload.
//
// The exact key that carries the tree is not guaranteed, so every JSON value under a likely key is
// walked and any object that looks like a category (numeric code + text title, no pricing/inventory)
// is collected. Parent comes from an explicit parent field or, failing that, from nesting.
// Finding nothing is not an error: products still show their numeric code in the dashboard.
import { extractAll, scanValue } from './rsc.mjs';

const CAT_KEYS = ['liaProductCategories', 'LiaProductCategories', 'productsCategories', 'categories', 'category', 'category_tree', 'categoryTree', 'children', 'sub_categories', 'subCategories', 'menu', 'filters'];
const NAME_KEYS = ['title', 'name', 'label', 'fa_title'];
const PARENT_KEYS = ['parent_code', 'parentCode', 'parent_id', 'parent'];
const CHILD_KEYS = ['children', 'sub_categories', 'subCategories', 'childs', 'items'];

const isProduct = (o) => 'pricing' in o || 'inventory' in o || 'payable_price' in o;
const nameOf = (o) => {
  for (const k of NAME_KEYS) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
  return null;
};
const parentOf = (o) => {
  for (const k of PARENT_KEYS) {
    const v = o[k];
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && typeof v.code === 'number') return v.code;
  }
  return undefined;
};

function walk(value, parent, out) {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, parent, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  let here = parent;
  if (typeof value.code === 'number' && !isProduct(value)) {
    const name = nameOf(value);
    if (name) {
      const explicit = parentOf(value);
      const prev = out.get(value.code);
      out.set(value.code, {
        code: value.code,
        name,
        parent_code: explicit !== undefined ? explicit : (parent ?? prev?.parent_code ?? null),
      });
      here = value.code;
    }
  }
  if (isProduct(value)) return; // a product's own nested category refs carry no tree position
  for (const k of CHILD_KEYS) if (value[k]) walk(value[k], here, out);
}

// Liateam's own shape, wherever it sits in the payload:
//   {"id":"<uuid>","code":151,"type":"product","title":"عطر",…,"parent_code":null}
// Anchored on the object start; accepted only if it carries parent_code and is not a product.
const CATEGORY_START = /\{"id":"[^"]{1,64}","code":\d+,/g;
function scanCategoryObjects(text, out) {
  for (const m of text.matchAll(CATEGORY_START)) {
    const end = scanValue(text, m.index);
    if (end <= m.index) continue;
    let o;
    try { o = JSON.parse(text.slice(m.index, end)); } catch { continue; }
    if (!('parent_code' in o) || isProduct(o) || 'product_code' in o) continue;
    const name = nameOf(o);
    if (!name || out.has(o.code)) continue;
    out.set(o.code, { code: o.code, name, parent_code: typeof o.parent_code === 'number' ? o.parent_code : null });
  }
}

/** @returns {Map<number, {code, name, parent_code}>} */
export function parseCategories(text) {
  const out = new Map();
  scanCategoryObjects(text, out);
  for (const key of CAT_KEYS) for (const v of extractAll(text, key)) walk(v, null, out);
  for (const c of out.values()) if (c.parent_code === c.code) c.parent_code = null;
  return out;
}

/** Display name for a category code; falls back to the code itself (unnamed categories). */
export const categoryLabel = (code, byCode) => byCode.get(code)?.name || `#${code}`;
