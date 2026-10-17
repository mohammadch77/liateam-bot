/**
 * Search text normalisation — must stay identical to public.search_norm() in deploy/shop-db-004-search.sql:
 * lower case; Arabic ي ى ئ → ی, ك → ک, ة ۀ → ه, أ إ آ → ا, ؤ → و; ZWNJ → space; Persian/Arabic digits → 0-9;
 * tatweel and harakat removed; anything that is not a letter or digit → space; spaces collapsed.
 * Shared by the server (query words) and the browser (highlighting the matched part of a suggestion).
 */
// written as code points: several of these characters are invisible or combining
const MAP: Record<string, string> = {};
const fold = (from: number[], to: string) => from.forEach((c) => (MAP[String.fromCharCode(c)] = to));
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
function foldChar(ch: string): string {
  if (DROPPED.test(ch)) return '';
  const mapped = MAP[ch] ?? ch.toLowerCase();
  return WORD_CHAR.test(mapped) ? mapped : ' ';
}

export function normalizeSearch(text: string): string {
  let out = '';
  for (const ch of text) out += foldChar(ch);
  return out.replace(/\s+/g, ' ').trim();
}

export const SEARCH_LIMITS = { maxWords: 6, maxWordLength: 30 } as const;

/** Distinct normalised words of a query (at most 6, each at most 30 characters). */
export function searchWords(q: string | undefined | null): string[] {
  if (!q) return [];
  const words = normalizeSearch(q)
    .split(' ')
    .filter(Boolean)
    .map((w) => w.slice(0, SEARCH_LIMITS.maxWordLength));
  return [...new Set(words)].slice(0, SEARCH_LIMITS.maxWords);
}

export type Segment = { text: string; hit: boolean };

/**
 * Splits `text` into plain and matched parts for highlighting: every place where a query word (or one of its
 * corrections) occurs, compared in normalised form so «ريمل» highlights «ریمل» and «ارایشی» highlights «آرایشی».
 */
export function highlight(text: string, words: readonly string[]): Segment[] {
  // normalised string + for each of its characters the index range in the original text
  let norm = '';
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (const c of f) {
      norm += c;
      from.push(i);
      to.push(i + ch.length);
    }
    i += ch.length;
  }
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    if (!w) continue;
    for (let at = norm.indexOf(w); at >= 0; at = norm.indexOf(w, at + 1)) {
      const start = from[at] ?? 0;
      const end = to[at + w.length - 1] ?? start;
      for (let k = start; k < end; k++) hit[k] = true;
    }
  }
  const out: Segment[] = [];
  for (let k = 0; k < text.length; k++) {
    const h = hit[k] ?? false;
    const ch = text.charAt(k);
    const last = out[out.length - 1];
    if (last && last.hit === h) last.text += ch;
    else out.push({ text: ch, hit: h });
  }
  return out;
}

/** Edit distance with adjacent transpositions (optimal string alignment), stopping early above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const at = (row: readonly number[], j: number) => row[j] ?? Number.MAX_SAFE_INTEGER;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      let v = Math.min(at(prev, j) + 1, at(cur, j - 1) + 1, at(prev, j - 1) + (same ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, at(prev2, j - 2) + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return at(prev, b.length);
}
