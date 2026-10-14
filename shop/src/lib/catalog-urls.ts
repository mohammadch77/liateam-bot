/**
 * Clean Persian URLs: /p/1234-سرم-آبرسان-هیالورونیک and /c/56-مراقبت-پوست. The number is the supplier code
 * (the only part that is read); the words are for people and search engines. A wrong or missing slug is
 * redirected to the canonical URL, so renaming a product never breaks old links.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[‌‏‎]/g, '-') // ZWNJ and direction marks
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
}

const withSlug = (base: string, id: number, name: string | null) => {
  const slug = name ? slugify(name) : '';
  return `${base}/${id}${slug ? `-${slug}` : ''}`;
};

export const productPath = (id: number, name: string | null) => withSlug('/p', id, name);
export const categoryPath = (code: number, name: string | null) => withSlug('/c', code, name);

/** '1234-سرم-…' (raw or percent-encoded) → 1234, or null. */
export function idFromSlug(param: string): number | null {
  let s = param;
  try {
    s = decodeURIComponent(param);
  } catch {
    /* already decoded */
  }
  const m = /^(\d{1,9})(?:-|$)/.exec(s);
  return m ? Number(m[1]) : null;
}
