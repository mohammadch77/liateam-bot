// English URL slugs for products: <brand latin>-<transliterated name>-<code>, e.g.
// "serge-rimel-abro-ghahvei-tire-serzh-541". The code at the end makes it unique; the bot assigns it once
// (supplier_products.slug_en IS NULL) and never rewrites it, so a renamed product keeps its URL. The Persian
// slug of that moment is stored next to it (slug_fa) so the site can redirect old Persian links.

// Persian/Arabic letter → Latin, a simple readable scheme (not a scholarly one). Vowels that Persian does not
// write cannot be recovered; the result is for URLs, not for people to read aloud.
const MAP = {
  'آ': 'a', 'ا': 'a', 'أ': 'a', 'إ': 'e', 'ء': '', 'ئ': 'y', 'ؤ': 'o', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 's',
  'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's',
  'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'gh', 'ک': 'k',
  'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'و': 'v', 'ه': 'h', 'ة': 'h', 'ی': 'i', 'ي': 'i', 'ى': 'i',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

// Latin names of Liateam's brands. Liateam's API has no Latin name; these are used when it gives none (an admin
// can also set brands.latin_name by hand, which is kept). Spellings to be confirmed by the client.
export const KNOWN_BRAND_LATIN = {
  'سرژه': 'Serge',
  'لایف‌گارد': 'Lifeguard',
  'کلاس یک': 'Class One',
  'تراست پرو': 'Trust Pro',
  'تراست اورا': 'Trust Aura',
  'تراست اسلیم': 'Trust Slim',
  'تراست اسمارت': 'Trust Smart',
};

/** Free text (Persian, Latin or mixed) → lowercase ASCII words joined by '-'. */
export function transliterate(text) {
  const words = String(text ?? '')
    .normalize('NFC')
    .replace(/[ً-ْٰ]/g, '') // Arabic diacritics
    .split(/[\s‌‏‎\-_/(),.،:;«»"'+&]+/)
    .filter(Boolean);
  return words
    .map((w) => {
      let out = '';
      for (let i = 0; i < w.length; i++) {
        const c = w[i];
        // و between consonants and ی at a word end read as vowels ("o", "i") more often than not
        if (c === 'و' && i > 0) out += 'o';
        else if (c === 'ه' && i === w.length - 1 && i > 0) out += 'e';
        else if (c === 'ی' && i === 0) out += 'y';
        else if (c in MAP) out += MAP[c];
        else out += c.toLowerCase();
      }
      return out.replace(/[^a-z0-9]+/g, '');
    })
    .filter(Boolean)
    .join('-');
}

/** Same rules as the shop's slugify (shop/src/lib/catalog-urls.ts), so the stored Persian slug matches its URLs. */
export function persianSlug(name) {
  return String(name ?? '')
    .normalize('NFC')
    .replace(/[‌‏‎]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
}

/** "<brand>-<name>-<code>", at most ~90 characters, cut on a word boundary; always ends with the code. */
export function englishSlug({ code, name, brandLatin }) {
  const words = [brandLatin ? transliterate(brandLatin) : '', transliterate(name)].filter(Boolean).join('-');
  let base = words.slice(0, 80);
  if (words.length > 80) base = base.replace(/-[^-]*$/, '');
  return base ? `${base}-${code}` : String(code);
}
