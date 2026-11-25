/**
 * Pure Blog types, Persian slug generator, reading-time estimator,
 * strict XSS-safe HTML allowlist sanitizer, TOC extractor, and live Yoast-style Persian SEO analyzer.
 */

export type BlogPostStatus = 'draft' | 'scheduled' | 'published';

export type BlogCategoryDTO = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  postCount?: number;
};

export type BlogPostSummaryDTO = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  title: string;
  slug: string;
  excerpt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  tags: string[];
  readingTimeMinutes: number;
  authorName: string;
  status: BlogPostStatus;
  effectiveStatus: BlogPostStatus;
  publishedAt: string | null;
  seoScore: number;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BlogPostDetailDTO = BlogPostSummaryDTO & {
  contentHtml: string;
};

export type SeoCheckStatus = 'good' | 'warn' | 'bad';

export type SeoCheckItem = {
  id: string;
  label: string;
  detail: string;
  status: SeoCheckStatus;
  points: number;
  maxPoints: number;
};

export type SeoAnalysisResult = {
  score: number;
  grade: 'excellent' | 'good' | 'needs_work' | 'poor';
  gradeLabel: string;
  wordCount: number;
  suggestedReadingMinutes: number;
  keywordDensityPercent: number;
  checks: SeoCheckItem[];
};

export type TocHeading = {
  id: string;
  level: 2 | 3;
  text: string;
};

/** Generate a clean URL-safe slug supporting Persian & Latin letters. */
export function slugifyBlog(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u200c\u200f\u200e]+/g, '-')
    .replace(/[^a-z0-9\u0600-\u06FF\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 110);
}

/** Strip HTML tags to plain text for word count and SEO analysis. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&zwnj;/gi, '\u200c')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(htmlOrText: string): number {
  const plain = stripHtmlToText(htmlOrText);
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

export function estimateReadingMinutes(htmlOrText: string): number {
  const words = countWords(htmlOrText);
  return Math.max(1, Math.min(120, Math.ceil(words / 200)));
}

/**
 * Strict XSS-safe HTML sanitizer for rich blog content.
 * Allows semantic editorial tags, safe links (http/https/relative), standardized images/figures,
 * and safe text-align styles while stripping scripts, iframes, event handlers, and javascript: URLs.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'h2',
  'h3',
  'h4',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'mark',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'figure',
  'figcaption',
  'div',
  'span',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'pre',
  'code',
]);

function isSafeHref(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true;
  return /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed);
}

function isSafeImgSrc(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/')) return true;
  return /^https?:\/\//i.test(trimmed);
}

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

export function sanitizeBlogHtml(rawHtml: string): string {
  if (!rawHtml) return '';

  // Remove dangerous block elements completely with their inner content
  let html = rawHtml
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|meta|link|base)[^>]*\/?>/gi, '');

  // Sanitize remaining tags one by one
  html = html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_full, slash: string, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    // Demote h1 inside body to h2 so page always has a single H1 (best SEO practice)
    const finalTag = tag === 'h1' ? 'h2' : tag;
    if (!ALLOWED_TAGS.has(finalTag)) return '';
    if (slash) return `</${finalTag}>`;

    const kept: string[] = [];

    // Safe text-align style on block elements
    const style = extractAttr(rawAttrs, 'style');
    if (style) {
      const alignMatch = /text-align\s*:\s*(right|left|center|justify)/i.exec(style);
      if (alignMatch?.[1]) {
        kept.push(`style="text-align:${alignMatch[1].toLowerCase()}"`);
      }
    }

    if (finalTag === 'a') {
      const href = extractAttr(rawAttrs, 'href');
      if (href && isSafeHref(href)) {
        kept.push(`href="${escapeAttr(href)}"`);
        const target = extractAttr(rawAttrs, 'target');
        const rel = extractAttr(rawAttrs, 'rel');
        if (target === '_blank') {
          kept.push('target="_blank"');
          const relParts = new Set(['noopener', 'noreferrer']);
          if (rel && /\bnofollow\b/i.test(rel)) relParts.add('nofollow');
          kept.push(`rel="${Array.from(relParts).join(' ')}"`);
        } else if (rel && /\bnofollow\b/i.test(rel)) {
          kept.push('rel="nofollow"');
        }
      }
    } else if (finalTag === 'img') {
      const src = extractAttr(rawAttrs, 'src');
      if (!src || !isSafeImgSrc(src)) return '';
      kept.push(`src="${escapeAttr(src)}"`);
      const alt = extractAttr(rawAttrs, 'alt') ?? '';
      kept.push(`alt="${escapeAttr(alt)}"`);
      kept.push('loading="lazy"');
      return `<img ${kept.join(' ')} />`;
    } else if (finalTag === 'figure') {
      kept.push('class="av-blog-figure"');
    } else if (finalTag === 'h2' || finalTag === 'h3') {
      const id = extractAttr(rawAttrs, 'id');
      if (id && /^[a-z0-9-]+$/i.test(id)) kept.push(`id="${escapeAttr(id)}"`);
    }

    if (finalTag === 'br' || finalTag === 'hr') return `<${finalTag} />`;
    return kept.length ? `<${finalTag} ${kept.join(' ')}>` : `<${finalTag}>`;
  });

  return html.trim();
}

/**
 * Inject deterministic anchor IDs into h2/h3 headings and return a Table of Contents list.
 */
export function buildTocAndAnnotatedHtml(sanitizedHtml: string): {
  html: string;
  headings: TocHeading[];
} {
  const headings: TocHeading[] = [];
  let idx = 0;

  const html = sanitizedHtml.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi, (_match, tag: string, attrs: string, inner: string) => {
    const text = stripHtmlToText(inner);
    if (!text) return _match;
    idx += 1;
    const id = `sec-${idx}`;
    const level = tag.toLowerCase() === 'h2' ? 2 : 3;
    headings.push({ id, level, text });
    const cleanAttrs = attrs.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<${tag.toLowerCase()}${cleanAttrs} id="${id}">${inner}</${tag.toLowerCase()}>`;
  });

  return { html, headings };
}

/**
 * Real-time Yoast-style SEO Analyzer (0–100 score + actionable Persian checklist).
 */
export function analyzeBlogSeo(input: {
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  excerpt: string;
  contentHtml: string;
  coverImageUrl: string;
  coverImageAlt: string;
  tags: readonly string[];
}): SeoAnalysisResult {
  const kw = input.focusKeyword.trim().toLowerCase();
  const title = input.title.trim();
  const metaTitle = (input.metaTitle.trim() || title).trim();
  const metaDesc = input.metaDescription.trim();
  const plainText = stripHtmlToText(input.contentHtml);
  const plainLower = plainText.toLowerCase();
  const words = plainText ? plainText.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const suggestedReadingMinutes = Math.max(1, Math.ceil(wordCount / 200));

  // Count keyword occurrences & density
  let kwCount = 0;
  if (kw && plainLower) {
    let pos = 0;
    while (true) {
      const found = plainLower.indexOf(kw, pos);
      if (found === -1) break;
      kwCount += 1;
      pos = found + kw.length;
    }
  }
  const kwWordLen = kw ? kw.split(/\s+/).filter(Boolean).length : 1;
  const keywordDensityPercent =
    wordCount > 0 && kwCount > 0 ? Number((((kwCount * kwWordLen) / wordCount) * 100).toFixed(2)) : 0;

  const firstParagraphMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(input.contentHtml);
  const firstParagraphText = stripHtmlToText(firstParagraphMatch?.[1] ?? plainText.slice(0, 320)).toLowerCase();

  const h2Count = (input.contentHtml.match(/<h2\b/gi) ?? []).length;
  const h3Count = (input.contentHtml.match(/<h3\b/gi) ?? []).length;
  const linkCount = (input.contentHtml.match(/<a\s+[^>]*href=/gi) ?? []).length;
  const bodyImgCount = (input.contentHtml.match(/<img\s+/gi) ?? []).length;

  const checks: SeoCheckItem[] = [];

  // 1. Focus keyword defined (10 pts)
  checks.push(
    kw.length >= 2
      ? {
          id: 'focus_keyword',
          label: 'کلمه کلیدی اصلی تعریف شده است',
          detail: `کلمه کلیدی: «${input.focusKeyword.trim()}»`,
          status: 'good',
          points: 10,
          maxPoints: 10,
        }
      : {
          id: 'focus_keyword',
          label: 'کلمه کلیدی اصلی وارد نشده است',
          detail: 'یک عبارت کلیدی اصلی برای هدف‌گذاری در نتایج گوگل انتخاب کنید.',
          status: 'bad',
          points: 0,
          maxPoints: 10,
        },
  );

  // 2. Keyword in Title & Meta Title (12 pts)
  const kwInTitle = Boolean(kw && title.toLowerCase().includes(kw));
  const kwInMetaTitle = Boolean(kw && metaTitle.toLowerCase().includes(kw));
  checks.push(
    kw && kwInTitle && kwInMetaTitle
      ? {
          id: 'kw_title',
          label: 'کلمه کلیدی در عنوان مقاله و عنوان متا وجود دارد',
          detail: 'حضور دقیق عبارت کلیدی در هر دو عنوان عالی است.',
          status: 'good',
          points: 12,
          maxPoints: 12,
        }
      : kw && (kwInTitle || kwInMetaTitle)
        ? {
            id: 'kw_title',
            label: 'کلمه کلیدی فقط در یکی از عنوان‌ها آمده است',
            detail: 'برای بهترین امتیاز سئو، کلمه کلیدی را هم در عنوان مقاله و هم در عنوان متا قرار دهید.',
            status: 'warn',
            points: 6,
            maxPoints: 12,
          }
        : {
            id: 'kw_title',
            label: 'کلمه کلیدی در عنوان مقاله و متا تایتل یافت نشد',
            detail: 'قرار دادن کلمه کلیدی در عنوان، مهم‌ترین سیگنال رتبه‌بندی است.',
            status: 'bad',
            points: 0,
            maxPoints: 12,
          },
  );

  // 3. Meta Title length (10 pts: 35–65 ideal)
  const mtLen = metaTitle.length;
  checks.push(
    mtLen >= 35 && mtLen <= 65
      ? {
          id: 'meta_title_len',
          label: 'طول عنوان متا استاندارد است',
          detail: `${mtLen} کاراکتر (بازه طلایی: ۳۵ تا ۶۵ کاراکتر).`,
          status: 'good',
          points: 10,
          maxPoints: 10,
        }
      : mtLen >= 20 && mtLen <= 75
        ? {
            id: 'meta_title_len',
            label: 'طول عنوان متا قابل بهبود است',
            detail: `الان ${mtLen} کاراکتر است؛ بازه پیشنهادی بین ۳۵ تا ۶۵ کاراکتر است.`,
            status: 'warn',
            points: 5,
            maxPoints: 10,
          }
        : {
            id: 'meta_title_len',
            label: 'طول عنوان متا خارج از محدوده استاندارد است',
            detail: mtLen === 0 ? 'عنوان متا خالی است.' : `${mtLen} کاراکتر (ممکن است در گوگل بریده یا خیلی کوتاه باشد).`,
            status: 'bad',
            points: 0,
            maxPoints: 10,
          },
  );

  // 4. Meta Description length + keyword (12 pts)
  const mdLen = metaDesc.length;
  const kwInDesc = Boolean(kw && metaDesc.toLowerCase().includes(kw));
  checks.push(
    mdLen >= 115 && mdLen <= 165 && kwInDesc
      ? {
          id: 'meta_desc',
          label: 'متا دیسکریپشن کامل و شامل کلمه کلیدی است',
          detail: `${mdLen} کاراکتر با حضور کلمه کلیدی (بازه استاندارد: ۱۱۵ تا ۱۶۵).`,
          status: 'good',
          points: 12,
          maxPoints: 12,
        }
      : mdLen >= 70 && mdLen <= 180
        ? {
            id: 'meta_desc',
            label: 'متا دیسکریپشن نیاز به بهینه‌سازی جزئی دارد',
            detail: kwInDesc
              ? `طول فعلی ${mdLen} کاراکتر است (بازه ایده‌آل ۱۱۵ تا ۱۶۵).`
              : `طول ${mdLen} کاراکتر است اما کلمه کلیدی اصلی در آن به کار نرفته است.`,
            status: 'warn',
            points: 6,
            maxPoints: 12,
          }
        : {
            id: 'meta_desc',
            label: 'متا دیسکریپشن ناقص یا خیلی کوتاه/بلند است',
            detail: 'یک توضیح جذاب بین ۱۲۰ تا ۱۶۰ کاراکتر حاوی کلمه کلیدی بنویسید.',
            status: 'bad',
            points: 0,
            maxPoints: 12,
          },
  );

  // 5. Keyword in first paragraph & healthy density (12 pts)
  const kwInIntro = Boolean(kw && firstParagraphText.includes(kw));
  const goodDensity = keywordDensityPercent >= 0.4 && keywordDensityPercent <= 3.5;
  checks.push(
    kw && kwInIntro && goodDensity
      ? {
          id: 'kw_body',
          label: 'توزیع کلمه کلیدی در مقدمه و متن عالی است',
          detail: `تکرار: ${kwCount} بار (چگالی ${keywordDensityPercent}٪).`,
          status: 'good',
          points: 12,
          maxPoints: 12,
        }
      : kw && (kwInIntro || kwCount > 0)
        ? {
            id: 'kw_body',
            label: 'استفاده از کلمه کلیدی در متن قابل بهبود است',
            detail: kwInIntro
              ? `چگالی فعلی ${keywordDensityPercent}٪ است (بازه مناسب ۰.۵٪ تا ۳٪).`
              : 'پیشنهاد می‌شود کلمه کلیدی در پاراگراف اول نیز ذکر شود.',
            status: 'warn',
            points: 6,
            maxPoints: 12,
          }
        : {
            id: 'kw_body',
            label: 'کلمه کلیدی در متن مقاله به کار نرفته است',
            detail: 'کلمه کلیدی اصلی را به‌صورت طبیعی در مقدمه و بدنه مقاله استفاده کنید.',
            status: 'bad',
            points: 0,
            maxPoints: 12,
          },
  );

  // 6. Content length (12 pts)
  checks.push(
    wordCount >= 300
      ? {
          id: 'word_count',
          label: 'حجم محتوای مقاله مناسب سئو است',
          detail: `${wordCount} کلمه (حداقل پیشنهادی ۳۰۰ کلمه).`,
          status: 'good',
          points: 12,
          maxPoints: 12,
        }
      : wordCount >= 150
        ? {
            id: 'word_count',
            label: 'متن مقاله نسبتاً کوتاه است',
            detail: `${wordCount} کلمه؛ افزودن توضیحات تخصصی بیشتر به بالای ۳۰۰ کلمه رتبه را تقویت می‌کند.`,
            status: 'warn',
            points: 6,
            maxPoints: 12,
          }
        : {
            id: 'word_count',
            label: 'تعداد کلمات مقاله خیلی کم است',
            detail: `${wordCount} کلمه؛ برای رقابت در گوگل حداقل ۳۰۰ کلمه محتوای مفید بنویسید.`,
            status: 'bad',
            points: 0,
            maxPoints: 12,
          },
  );

  // 7. Headings structure H2/H3 (10 pts)
  checks.push(
    h2Count >= 2
      ? {
          id: 'headings',
          label: 'ساختار تیتربندی (H2/H3) استاندارد است',
          detail: `${h2Count} تیتر H2 و ${h3Count} تیتر H3 (فهرست مطالب خودکار ساخته می‌شود).`,
          status: 'good',
          points: 10,
          maxPoints: 10,
        }
      : h2Count === 1 || h3Count >= 1
        ? {
            id: 'headings',
            label: 'تعداد زیرتیترها کم است',
            detail: 'استفاده از حداقل ۲ تیتر H2 خوانایی و سئوی مقاله را بهتر می‌کند.',
            status: 'warn',
            points: 5,
            maxPoints: 10,
          }
        : {
            id: 'headings',
            label: 'هیچ زیرتیتری (H2/H3) در متن نیست',
            detail: 'متن را با تیترهای H2 و H3 بخش‌بندی کنید.',
            status: 'bad',
            points: 0,
            maxPoints: 10,
          },
  );

  // 8. Cover Image & Alt Text (10 pts)
  const hasCover = Boolean(input.coverImageUrl.trim());
  const hasAlt = Boolean(input.coverImageAlt.trim());
  checks.push(
    hasCover && hasAlt
      ? {
          id: 'cover_image',
          label: 'تصویر شاخص و متن جایگزین (Alt) تنظیم شده است',
          detail: bodyImgCount > 0 ? `به همراه ${bodyImgCount} تصویر در میانه متن.` : 'آماده نمایش استاندارد در همه دستگاه‌ها.',
          status: 'good',
          points: 10,
          maxPoints: 10,
        }
      : hasCover
        ? {
            id: 'cover_image',
            label: 'تصویر شاخص متن جایگزین (Alt) ندارد',
            detail: 'متن جایگزین (Alt) برای سئو تصاویر و دسترس‌پذیری ضروری است.',
            status: 'warn',
            points: 5,
            maxPoints: 10,
          }
        : {
            id: 'cover_image',
            label: 'تصویر شاخص انتخاب نشده است',
            detail: 'یک تصویر شاخص باکیفیت بارگذاری کنید.',
            status: 'bad',
            points: 0,
            maxPoints: 10,
          },
  );

  // 9. Links in content (6 pts)
  checks.push(
    linkCount >= 1
      ? {
          id: 'links',
          label: 'لینک‌سازی در متن انجام شده است',
          detail: `${linkCount} لینک در متن مقاله شناسایی شد.`,
          status: 'good',
          points: 6,
          maxPoints: 6,
        }
      : {
          id: 'links',
          label: 'لینکی در متن وجود ندارد',
          detail: 'افزودن حداقل یک لینک داخلی به محصولات یا پک‌های فروشگاه پیشنهاد می‌شود.',
          status: 'warn',
          points: 0,
          maxPoints: 6,
        },
  );

  // 10. Tags & Excerpt (6 pts)
  const hasTags = input.tags.length >= 2;
  const hasExcerpt = input.excerpt.trim().length >= 30;
  checks.push(
    hasTags && hasExcerpt
      ? {
          id: 'tags_excerpt',
          label: 'برچسب‌ها و خلاصه مقاله کامل است',
          detail: `${input.tags.length} برچسب ثبت شده است.`,
          status: 'good',
          points: 6,
          maxPoints: 6,
        }
      : hasTags || hasExcerpt
        ? {
            id: 'tags_excerpt',
            label: 'برچسب‌ها یا خلاصه مقاله ناقص است',
            detail: 'حداقل ۲ برچسب مرتبط و یک خلاصه کوتاه بنویسید.',
            status: 'warn',
            points: 3,
            maxPoints: 6,
          }
        : {
            id: 'tags_excerpt',
            label: 'برچسب و خلاصه مقاله وارد نشده است',
            detail: 'خلاصه و برچسب‌ها به کشف‌پذیری مقالات کمک می‌کنند.',
            status: 'bad',
            points: 0,
            maxPoints: 6,
          },
  );

  const score = Math.min(
    100,
    Math.max(
      0,
      checks.reduce((acc, c) => acc + c.points, 0),
    ),
  );

  const grade: SeoAnalysisResult['grade'] =
    score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'needs_work' : 'poor';
  const gradeLabel =
    grade === 'excellent'
      ? 'عالی برای سئو'
      : grade === 'good'
        ? 'خوب و قابل قبول'
        : grade === 'needs_work'
          ? 'نیاز به بهینه‌سازی'
          : 'ضعیف — نیاز به تکمیل';

  return {
    score,
    grade,
    gradeLabel,
    wordCount,
    suggestedReadingMinutes,
    keywordDensityPercent,
    checks,
  };
}
