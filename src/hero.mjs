// Hero slides of Liateam's home page («sliders» in its RSC payload): photo, mobile photo, colour, destination.
// Pure parsing, no database; db.mjs saveHeroSlides decides which destinations exist on our site.
import crypto from 'node:crypto';
import { extractAll } from './rsc.mjs';

// Liateam's own image host only (same rule as the product gallery)
const IMAGE_HOST = /^https:\/\/s3\.liateam\.ir\/[\w/.%-]+\.(?:png|jpe?g|webp|gif|avif)$/i;
const SOURCE_HOST = /^(?:www\.)?liateam\.ir$/i;
const COLOR = /^#[0-9a-f]{6}$/i;

const clean = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '') || null;

/**
 * Where a slide's link points on our site, or why it can't be shown:
 *   /products/314            → { type: 'product', code: 314 }
 *   /categories/150[/sub/153] → { type: 'category', code: 153 } (the deepest code)
 *   '#', '' or junk           → { skip: 'no-link' }
 *   another host              → { skip: 'external' }
 *   any other Liateam page    → { skip: 'no-page' } (e.g. /promotions/1641: we have no such page)
 */
export function slideTarget(link) {
  const raw = typeof link === 'string' ? link.trim() : '';
  if (!raw || raw.startsWith('#')) return { skip: 'no-link' };
  let url;
  try {
    url = new URL(raw, 'https://liateam.ir'); // scheme and host are case-insensitive ("Https://liateam.ir/...")
  } catch {
    return { skip: 'no-link' };
  }
  if (!/^https?:$/.test(url.protocol) || !SOURCE_HOST.test(url.hostname)) return { skip: 'external' };
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  let m = /^\/products\/(\d{1,9})$/.exec(path);
  if (m) return { type: 'product', code: Number(m[1]) };
  m = /^\/categories\/(\d{1,9})(?:\/sub\/(\d{1,9}))?$/.exec(path);
  if (m) return { type: 'category', code: Number(m[2] ?? m[1]) };
  return { skip: 'no-page' };
}

/**
 * @returns {{ found: false } | { found: true, slides: object[], skipped: object[] }}
 *   slides  - in Liateam's order (priority): { source_code, image_url, portrait_url, color, alt, target_type, target_code }
 *   skipped - { source_code, title, link, reason } (reason: no-link | external | no-page | bad-image)
 * found = false when the page has no slider list at all (page layout changed: keep what we have).
 */
export function parseHeroSlides(text) {
  const list = extractAll(text, 'sliders').find(
    (v) => Array.isArray(v) && v.some((x) => x && typeof x === 'object' && 'image' in x && 'link' in x));
  if (!list) return { found: false };
  const active = list
    .filter((x) => x && typeof x === 'object' && (x.status ?? 'active') === 'active' && (x.type ?? 'main') === 'main')
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || (Number(a.code) || 0) - (Number(b.code) || 0));
  const slides = [];
  const skipped = [];
  const seen = new Set();
  for (const x of active) {
    const source_code = Number.isInteger(x.code) ? x.code : null;
    const title = clean(x.alt_image) ?? clean(x.title);
    const target = slideTarget(x.link);
    const image = typeof x.image === 'string' ? x.image.trim() : '';
    const reason = target.skip ?? (!IMAGE_HOST.test(image) ? 'bad-image' : null);
    if (reason) {
      skipped.push({ source_code, title, link: typeof x.link === 'string' ? x.link : null, reason });
      continue;
    }
    if (seen.has(image)) continue; // the same banner twice
    seen.add(image);
    const portrait = typeof x.portrait_image === 'string' ? x.portrait_image.trim() : '';
    slides.push({
      source_code,
      image_url: image,
      portrait_url: IMAGE_HOST.test(portrait) ? portrait : null,
      color: COLOR.test(x.color ?? '') ? x.color.toLowerCase() : null,
      alt: title,
      target_type: target.type,
      target_code: target.code,
    });
  }
  return { found: true, slides, skipped };
}

/** Change detector: same slides in the same order → same hash. */
export const heroHash = (slides) =>
  crypto.createHash('sha256').update(JSON.stringify(slides.map((s) => [s.source_code, s.image_url, s.portrait_url,
    s.color, s.alt, s.target_type, s.target_code]))).digest('hex').slice(0, 16);

export const SKIP_REASON_FA = {
  'no-link': 'لینک ندارد',
  external: 'لینک به سایت دیگر',
  'no-page': 'مقصد در سایت ما صفحه ندارد',
  'bad-image': 'عکس از هاست لیاتیم نیست',
  'unknown-product': 'محصولش در کاتالوگ ما نیست',
  'unknown-category': 'دسته‌اش در کاتالوگ ما نیست',
};
