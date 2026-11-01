// Plain ES module: shared with scripts/check-search.mjs, which runs on Node 20 without a TS loader. Keep it free of TS syntax.
// Must stay identical to public.search_norm() in deploy/shop-db-004-search.sql (see normalize.ts).
// written as code points: several of these characters are invisible or combining
const MAP = {};
const fold = (from, to) => from.forEach((c) => (MAP[String.fromCharCode(c)] = to));
fold([0x064a, 0x0649, 0x0626], 'ی'); // ي ى ئ
fold([0x0643], 'ک'); // ك
fold([0x0629, 0x06c0], 'ه'); // ة ۀ
fold([0x0623, 0x0625, 0x0622], 'ا'); // أ إ آ
fold([0x0624], 'و'); // ؤ
fold([0x200c], ' '); // ZWNJ (نیم‌فاصله)
for (let d = 0; d < 10; d++) fold([0x06f0 + d, 0x0660 + d], String(d)); // ۰-۹, ٠-٩
// tatweel U+0640, harakat U+064B–U+0652, superscript alef U+0670
const DROPPED = new RegExp(
  `[${String.fromCharCode(0x0640)}${String.fromCharCode(0x064b)}-${String.fromCharCode(0x0652)}${String.fromCharCode(0x0670)}]`,
);
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Normalised form of one character: '' (dropped), ' ' (separator) or the folded character(s). */
export function foldChar(ch) {
  if (DROPPED.test(ch)) return '';
  const mapped = MAP[ch] ?? ch.toLowerCase();
  return WORD_CHAR.test(mapped) ? mapped : ' ';
}

export function normalizeSearch(text) {
  let out = '';
  for (const ch of text) out += foldChar(ch);
  return out.replace(/\s+/g, ' ').trim();
}
