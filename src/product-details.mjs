// Brand and description from a product's own page (/products/{code}?_rsc). Never throws: a field that cannot be
// found is null, and the caller logs it. Description HTML is reduced to safe structured text (no markup is ever
// stored or rendered): blocks separated by a blank line, "## " for headings, "• " for list items.
import { scanValue } from './rsc.mjs';

// Paths tried in order (first non-empty wins), like normalize.mjs's FIELD_PATHS.
export const DETAIL_PATHS = {
  brand: ['brand.title', 'brand.name', 'brand_title', 'brand_name'],
  description: ['description', 'summary', 'content', 'body'],
};

const MAX_DESCRIPTION = 8000;
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** The product object: the JSON object that carries this code together with its title and categories. */
function findProduct(text, code) {
  const marker = new RegExp(`"(?:code|product_code)":${code}[,}]`, 'g');
  for (const m of text.matchAll(marker)) {
    // walk back from the marker to each enclosing '{' and take the first that parses as the product
    for (let i = m.index, tries = 0; i >= 0 && tries < 400; i--) {
      if (text[i] !== '{') continue;
      tries++;
      const end = scanValue(text, i);
      if (end <= m.index) continue;
      try {
        const v = JSON.parse(text.slice(i, end));
        if (v && (v.code === code || v.product_code === code) && 'title' in v && ('categories' in v || 'brand' in v)) return v;
      } catch {
        /* not a whole JSON object */
      }
    }
  }
  return null;
}

/**
 * Long strings are sent as separate RSC rows and referenced as "$<hex id>". A row looks like `23:T26df,<text>`
 * where 26df is the text length in BYTES (UTF-8), so the slice must be done on bytes, not characters.
 */
function resolveRef(text, value) {
  const m = typeof value === 'string' && /^\$([0-9a-f]+)$/i.exec(value);
  if (!m) return value;
  const head = new RegExp(`(?:^|\\n)${m[1]}:T([0-9a-f]+),`, 'i').exec(text);
  if (!head) return null;
  const buf = Buffer.from(text, 'utf8');
  const start = Buffer.byteLength(text.slice(0, head.index + head[0].length), 'utf8');
  return buf.subarray(start, start + parseInt(head[1], 16)).toString('utf8');
}

// &shy; is a soft hyphen the supplier's editor puts where a ZWNJ belongs (سلول&shy;ها): keep it as a ZWNJ.
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", zwnj: '‌', zwj: '‍', shy: '‌', laquo: '«', raquo: '»' };
const decode = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
const stripTags = (s) => s.replace(/<[^>]*>/g, '');
const tidy = (s) => decode(stripTags(s)).replace(/[ \t ]+/g, ' ').trim();

/** Supplier HTML (inline styles, fonts, editor junk) → plain structured text. */
export function htmlToText(html) {
  if (!html) return null;
  let s = String(html)
    .replace(/<(script|style|iframe|object|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n');
  // headings, and paragraphs whose only text is bold (the supplier's way of writing a heading)
  s = s.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner) => `\n\n## ${tidy(inner)}\n\n`);
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => {
    const text = tidy(inner);
    if (!text) return '\n\n';
    const bold = tidy((inner.match(/<(strong|b)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? []).join(' '));
    const isHeading = bold && text.replace(/[:：\s]/g, '') === bold.replace(/[:：\s]/g, '') && text.length <= 120;
    return isHeading ? `\n\n## ${text.replace(/[:：]\s*$/, '')}\n\n` : `\n\n${text}\n\n`;
  });
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n• ${tidy(inner)}`);
  s = s.replace(/<\/?(ul|ol|div|section|table|tr)[^>]*>/gi, '\n\n');
  s = decode(stripTags(s)).replace(/­/g, '‌');
  const out = s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^• $/gm, '')
    .trim();
  if (!out) return null;
  return out.length > MAX_DESCRIPTION ? `${out.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, '')}…` : out;
}

/**
 * @returns {{ found: boolean, brand: string|null, description: string|null, paths: {brand?: string, description?: string} }}
 *   found=false: the product object itself was not in the page (structure change) — the caller keeps old values.
 */
export function parseProductDetails(text, code) {
  const product = findProduct(text, code);
  if (!product) return { found: false, brand: null, description: null, paths: {} };
  const paths = {};
  const pick = (field, clean) => {
    for (const p of DETAIL_PATHS[field]) {
      const raw = resolveRef(text, get(product, p));
      const v = raw == null ? null : clean(raw);
      if (v) {
        paths[field] = p;
        return v;
      }
    }
    return null;
  };
  const brand = pick('brand', (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) || null : null));
  const description = pick('description', (v) => (typeof v === 'string' ? htmlToText(v) : null));
  return { found: true, brand, description, paths };
}
