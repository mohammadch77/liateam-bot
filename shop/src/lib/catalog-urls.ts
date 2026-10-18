/**
 * Clean URLs. Products: /p/serge-rimel-abro-541, the English slug the sync bot assigns once (slug_en, ends with
 * the supplier code); until a product has one, and for categories, the Persian form /p/1234-سرم-آبرسان or
 * /c/56-مراقبت-پوست. Only the number is read; the words are for people and search engines. Any other form of a
 * product's address (old Persian links included) is redirected permanently to the canonical one.
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

const ENGLISH_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** slug_en when the bot has assigned one (it always ends with "-<id>"), otherwise /p/<id>-<Persian words>. */
export const productPath = (id: number, name: string | null, slugEn?: string | null) =>
  slugEn && ENGLISH_SLUG.test(slugEn) && slugEn.endsWith(`-${id}`)
    ? `/p/${slugEn}`
    : withSlug('/p', id, name);
export const categoryPath = (code: number, name: string | null) => withSlug('/c', code, name);

/**
 * The supplier code in a URL segment, or null: 'serge-rimel-541' (English slug, code last), '1234-سرم-…'
 * (Persian, raw or percent-encoded, code first) or '1234'. An all-ASCII segment is an English slug.
 */
export function idFromSlug(param: string): number | null {
  let s = param;
  try {
    s = decodeURIComponent(param);
  } catch {
    /* already decoded */
  }
  if (ENGLISH_SLUG.test(s) && !/^\d{1,9}$/.test(s)) {
    const tail = /-(\d{1,9})$/.exec(s);
    return tail ? Number(tail[1]) : null;
  }
  const m = /^(\d{1,9})(?:-|$)/.exec(s);
  return m ? Number(m[1]) : null;
}
