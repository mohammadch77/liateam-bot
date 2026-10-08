// Extracts JSON values embedded in a Next.js RSC payload by bracket-scanning.
// Throws (never returns partial data) if the expected structure is missing.

export class StructureError extends Error {}

/** Return the JSON value that starts right after every occurrence of `"key":`. */
export function extractAll(text, key) {
  const needle = `"${key}":`;
  const out = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    const start = at + needle.length;
    const end = scanValue(text, start);
    if (end > start) {
      try { out.push(JSON.parse(text.slice(start, end))); } catch { /* not JSON here, skip */ }
    }
    from = start;
  }
  return out;
}

// Returns end index (exclusive) of the [...] or {...} starting at `i`, or `i` if not a container.
function scanValue(s, i) {
  const open = s[i];
  if (open !== '[' && open !== '{') return i;
  let depth = 0, inStr = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (c === '\\') j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { if (--depth === 0) return j + 1; }
  }
  return i;
}

const LIST_KEYS = ['products', 'items', 'data', 'results'];
const TOTAL_KEYS = ['total', 'totalCount', 'total_count', 'count'];
const CURRENT_KEYS = ['current', 'page', 'current_page', 'currentPage'];

// Looks like a product list: objects with a numeric code and some kind of price info.
// (pricing may be null - that is the logged-out view, which the caller turns into an AuthError.)
const isProductList = (v) =>
  Array.isArray(v) && v.length > 0 &&
  v.every((p) => p && typeof p === 'object' && typeof p.code === 'number' && ('pricing' in p || 'price' in p));

const firstNumber = (text, keys) => {
  for (const k of keys) {
    const m = text.match(new RegExp(`"${k}":(\\d+)`));
    if (m) return { value: Number(m[1]), key: k };
  }
  return null;
};

/** The product list on a /categories page plus pagination meta. `page` is only for error messages. */
export function parseCategoriesPage(text, page) {
  const at = page ? ` در صفحه‌ی ${page}` : '';
  let products = null, listKey = null;
  for (const key of LIST_KEYS) {
    const lists = extractAll(text, key).filter(isProductList);
    if (lists.length) {
      products = lists.sort((a, b) => b.length - a.length)[0];
      listKey = key;
      break;
    }
  }
  if (!products) throw new StructureError(`لیست محصولات پیدا نشد${at} (کلیدهای امتحان‌شده: ${LIST_KEYS.join(', ')})`);
  const total = firstNumber(text, TOTAL_KEYS);
  if (!total) throw new StructureError(`تعداد کل محصولات (total) پیدا نشد${at}`);
  const current = firstNumber(text, CURRENT_KEYS);
  const fallbacks = [
    ...(listKey !== LIST_KEYS[0] ? [{ field: 'list', path: listKey }] : []),
    ...(total.key !== TOTAL_KEYS[0] ? [{ field: 'total', path: total.key }] : []),
  ];
  return { products, total: total.value, current: current?.value ?? null, fallbacks };
}
