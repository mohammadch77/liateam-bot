// Brand and description from a product's own page (/products/{code}?_rsc). Never throws: a field that cannot be
// found is null, and the caller logs it. Description HTML is reduced to safe structured text (no markup is ever
// stored or rendered): blocks separated by a blank line, "## " for headings, "• " for list items.
import { createHash } from 'node:crypto';
import { extractAll, scanValue } from './rsc.mjs';

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
  if (!product) return { found: false, brand: null, description: null, paths: {}, rich: null, brands: parseBrands(text) };
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
  return { found: true, brand, description, paths, rich: parseRich(text, product), brands: parseBrands(text) };
}

// ---------------------------------------------------------------- rich sections (product page tabs)
// Everything below is stored as plain text: markup is removed exactly like the description (no HTML is ever
// stored or rendered), lengths are capped, and nothing from the pricing block is read here.

const MAX_TEXT = 4000;
const MAX_REVIEWS = 10; // the first page Liateam renders (newest first)

/** Short plain field (summary line, attribute, FAQ, review): tags and entities removed, whitespace collapsed. */
export function cleanText(v, max = MAX_TEXT) {
  if (typeof v !== 'string') return null;
  const out = decode(stripTags(v.replace(/<br\s*\/?>/gi, '\n')))
    .replace(/­/g, '‌')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!out || !/[\p{L}\p{N}]/u.test(out)) return null; // also "." / "-" placeholders left in empty fields
  return out.length > max ? `${out.slice(0, max).replace(/\s+\S*$/, '')}…` : out;
}

// Videos are kept only from Liateam's own video hosting (ArvanCloud); anything else (a content-bank page, a
// foreign iframe) is dropped. Only the player URL is kept from the iframe HTML, never the HTML itself.
const VIDEO_FILE = /^https:\/\/[a-z0-9-]+\.arvanvod\.ir\/[\w/.-]+\.mp4$/i;
const VIDEO_PLAYER = /^https:\/\/player\.arvancloud\.ir\/index\.html\?config=https:\/\/[a-z0-9-]+\.arvanvod\.ir\/[\w/.-]+\.json$/i;
export function parseVideo(link, iframe) {
  const url = typeof link === 'string' && VIDEO_FILE.test(link.trim()) ? link.trim() : null;
  const src = typeof iframe === 'string' ? /<iframe\b[^>]*\bsrc="([^"]+)"/i.exec(iframe)?.[1]?.replace(/&amp;/g, '&') : null;
  const embed = src && VIDEO_PLAYER.test(src) ? src : null;
  return url || embed ? { url, embed } : null;
}

/** "معصومه اولیاگوکی" → "معصومه ا." — reviews are public, the full name of a customer is not needed. */
export function maskAuthor(name) {
  const words = cleanText(name, 80)?.split(/\s+/) ?? [];
  if (!words.length) return null;
  return words.length === 1 ? words[0] : `${words[0]} ${[...words.at(-1)][0]}.`;
}
const redact = (s) => s && s.replace(/(?:\+98|0)?9\d{9}|[\w.+-]+@[\w-]+\.[\w.]+/g, '…');

function parseReviews(text) {
  const list = extractAll(text, 'comments').find(
    (v) => Array.isArray(v) && v.length && v.every((c) => c && typeof c === 'object' && 'created_at' in c),
  ) ?? [];
  const total = extractAll(text, 'pagination').find((p) => p && Number.isInteger(p.total))?.total ?? list.length;
  const reviews = [];
  for (const c of list) {
    const body = redact(cleanText(c.description, 2000));
    if (!body) continue;
    const rate = Number(c.rate);
    reviews.push({
      source_code: Number.isInteger(c.code) ? c.code : null,
      author: maskAuthor(c.created_by),
      // "nps" reviews carry 1–10; plain comments carry 0 = no score
      rating: Number.isInteger(rate) && rate >= 1 && rate <= 10 ? rate : null,
      body,
      reply: redact(cleanText(c.reply?.description, 2000)),
      created_at: typeof c.created_at === 'string' && !Number.isNaN(Date.parse(c.created_at)) ? c.created_at : null,
    });
    if (reviews.length >= MAX_REVIEWS) break;
  }
  return { reviews, total: Math.max(total, reviews.length) };
}

// Same rule as every other image we keep: Liateam's own image host only (the shop serves them through its
// optimiser, never hotlinked).
const IMAGE_HOST = /^https:\/\/s3\.liateam\.ir\/[\w/.%-]+\.(?:png|jpe?g|webp|gif|avif)$/i;

/** Extra product photos in Liateam's order; the main photo (home_page_image → image_url) is not repeated. */
export function parseGallery(product) {
  const main = typeof product.home_page_image === 'string' ? product.home_page_image.trim() : null;
  const seen = new Set(main ? [main] : []);
  const out = [];
  for (const g of Array.isArray(product.gallery_images) ? product.gallery_images : []) {
    const url = typeof g?.image === 'string' ? g.image.trim() : '';
    if (!IMAGE_HOST.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, alt: cleanText(g.alt_image, 200) });
    if (out.length >= 12) break;
  }
  return out;
}

// Size: Liateam's measurement_value + measurement_type ("ml" / "gr"); stored as a number and 'ml' | 'g'.
const UNITS = { ml: 'ml', gr: 'g', g: 'g' };
export function parseMeasurement(value, type) {
  const n = Number(typeof value === 'string' ? value.trim() : value);
  const unit = UNITS[String(type ?? '').trim().toLowerCase()];
  return Number.isFinite(n) && n > 0 && n < 100000 && unit ? { value: Math.round(n * 100) / 100, unit } : null;
}

/** "#f0eaf150" / "#EBEBEB" → "#f0eaf1" (Liateam adds an alpha byte to some); anything else → null. */
export function parseColor(v) {
  const m = typeof v === 'string' ? /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v.trim()) : null;
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** Skin/hair concerns («ریزش مو», «خشکی پوست») in Liateam's order; picture only from its image host. */
export function parseConcerns(list) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const title = cleanText(c?.title, 80);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const image = typeof c?.image === 'string' && IMAGE_HOST.test(c.image.trim()) ? c.image.trim() : null;
    out.push({ code: Number.isInteger(c?.code) ? c.code : null, title, image_url: image });
    if (out.length >= 20) break;
  }
  return out;
}

/** Liateam's search tags («best-selling», «newest»): code, key, title. */
export function parseTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const key = cleanText(t?.key, 60);
    const title = cleanText(t?.title, 80);
    if (!key && !title) continue;
    out.push({ code: Number.isInteger(t?.code) ? t.code : null, key, title });
    if (out.length >= 20) break;
  }
  return out;
}

/** The product's tabs: summary, features, specs, how-to-use, video, FAQ, reviews, rating, brand code. */
export function parseRich(text, product) {
  const lines = (v) => (cleanText(resolveRef(text, v)) ?? '').split('\n').filter(Boolean);
  const attributes = (Array.isArray(product.attributes) ? product.attributes : [])
    .map((a) => ({ key: cleanText(a?.key, 120), value: cleanText(a?.value, 1000) }))
    .filter((a) => a.key && a.value);
  const faqs = (Array.isArray(product.faqs) ? product.faqs : [])
    .map((q) => ({ question: cleanText(q?.question, 500), answer: cleanText(resolveRef(text, q?.answer), 3000) }))
    .filter((q) => q.question && q.answer);
  const features = (Array.isArray(product.features) ? product.features : []).map((f) => cleanText(f, 300)).filter(Boolean);
  const rating = Number(product.rating_value);
  const brandCode = Number(product.brand?.code);
  return {
    summary: lines(product.summary).join('\n') || null,
    features,
    attributes,
    howToUse: cleanText(resolveRef(text, product.how_to_use)),
    video: parseVideo(product.video_link, product.video_iframe),
    faqs,
    ...parseReviews(text),
    rating: Number.isFinite(rating) && rating >= 0 && rating <= 100 ? Math.round(rating) : null,
    brandCode: Number.isInteger(brandCode) && brandCode > 0 ? brandCode : null,
    country: cleanText(product.country, 60),
    gallery: parseGallery(product),
    // facts: kept for the shop (size, colour, shelf life) and for reference (meta texts: not used for our SEO)
    measurement: parseMeasurement(product.measurement_value, product.measurement_type),
    color: parseColor(product.color),
    expireMonths: Number.isInteger(Number(product.expire_month)) && product.expire_month >= 1 && product.expire_month <= 120
      ? Number(product.expire_month) : null,
    metaTitle: cleanText(product.meta_title, 200),
    metaDescription: cleanText(product.meta_description, 500),
    // the product's own brand object carries the brand banners too (the brand list is not on every page)
    brandBanner: IMAGE_HOST.test(String(product.brand?.banner_image ?? '').trim()) ? product.brand.banner_image.trim() : null,
    brandBannerPortrait: IMAGE_HOST.test(String(product.brand?.banner_portrait_image ?? '').trim())
      ? product.brand.banner_portrait_image.trim() : null,
    concerns: parseConcerns(product.concerns),
    tags: parseTags(product.tags),
  };
}

/** Liateam's brand list (the "product/brands" query every page carries), in its order; [] if absent. */
export function parseBrands(text) {
  const at = text.indexOf('"queryKey":["product/brands"]');
  if (at < 0) return [];
  const start = text.lastIndexOf('{"dehydratedAt"', at);
  if (start < 0) return [];
  try {
    const data = JSON.parse(text.slice(start, scanValue(text, start)))?.state?.data;
    return (Array.isArray(data) ? data : [])
      .filter((b) => Number.isInteger(b?.code) && cleanText(b.title, 80))
      .map((b, i) => ({
        code: b.code,
        name: cleanText(b.title, 80),
        latin: cleanText(b.title_en ?? b.english_title ?? b.slug, 80)?.match(/^[\w .&'-]+$/)?.[0] ?? null,
        image: typeof b.image === 'string' && /^https:\/\/s3\.liateam\.ir\//.test(b.image) ? b.image : null,
        banner: IMAGE_HOST.test(String(b.banner_image ?? '').trim()) ? b.banner_image.trim() : null,
        bannerPortrait: IMAGE_HOST.test(String(b.banner_portrait_image ?? '').trim()) ? b.banner_portrait_image.trim() : null,
        position: i,
      }));
  } catch {
    return [];
  }
}

/** One hash per section, so a weekly re-read rewrites only the sections whose content really changed. */
export function sectionHashes(rich) {
  const h = (v) => createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16);
  return {
    summary: h([rich.summary, rich.features]),
    attributes: h(rich.attributes),
    how_to_use: h(rich.howToUse),
    video: h(rich.video),
    faqs: h(rich.faqs),
    reviews: h([rich.reviews, rich.total]),
    meta: h([rich.rating, rich.brandCode, rich.country]),
    gallery: h(rich.gallery),
    facts: h([rich.measurement, rich.color, rich.expireMonths, rich.metaTitle, rich.metaDescription]),
    concerns: h(rich.concerns),
    tags: h(rich.tags),
  };
}
