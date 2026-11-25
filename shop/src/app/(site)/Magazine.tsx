import Link from 'next/link';
import type { BlogPostSummaryDTO } from '@/lib/blog/seo';
import { getConfig } from '@/lib/config';
import { toFaDigits } from '@/lib/format/number';
import { Icon } from '@/ui';
import b from './blog/blog.module.css';
import s from './home-sections.module.css';

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return dateFa.format(new Date(iso));
  } catch {
    return '';
  }
}

/**
 * Homepage «مجله زیبایی و وبلاگ آوینا»: showcases the 3 latest published blog articles
 * in Avina's responsive 3-column editorial grid with standardized 16:10 cover framing.
 */
export function Magazine({ articles = [] }: { articles?: BlogPostSummaryDTO[] }) {
  const brand = getConfig().BRAND_NAME;

  return (
    <section
      className={s.section}
      aria-labelledby="magazine-title"
      data-home-section="magazine"
      data-magazine={articles.length > 0 ? 'live' : 'empty'}
    >
      <div className={b.homeBlogHead}>
        <h2 id="magazine-title" className={s.title}>
          {`مجله و وبلاگ ${brand}`}
        </h2>
        <Link href="/blog" className={b.homeBlogMore}>
          مشاهده همه مقالات
          <Icon name="arrow_back" size={16} />
        </Link>
      </div>

      {articles.length === 0 ? (
        <div className={b.emptyBox}>
          <Icon name="spa" size={34} />
          <span>مقالات راهنمای خرید و روتین مراقبت پوست و مو به‌زودی منتشر می‌شوند.</span>
        </div>
      ) : (
        <div className={b.grid} data-home-blog-grid>
          {articles.slice(0, 3).map((post) => (
            <Link key={post.id} href={`/blog/${post.slug}`} className={b.card} data-home-blog-card>
              <div className={b.cardImgFrame}>
                {post.coverImageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={post.coverImageUrl}
                    alt={post.coverImageAlt || post.title}
                    className={b.cardImg}
                    loading="lazy"
                  />
                ) : (
                  <div className={b.cardImgPlaceholder}>
                    <Icon name="spa" size={36} />
                  </div>
                )}
                {post.categoryName && <span className={b.cardBadge}>{post.categoryName}</span>}
              </div>

              <div className={b.cardBody}>
                <div className={b.cardMeta}>
                  <span>{fmtDate(post.publishedAt || post.createdAt)}</span>
                  <span className={b.metaDot}>•</span>
                  <span>{toFaDigits(post.readingTimeMinutes)} دقیقه مطالعه</span>
                </div>
                <h3 className={b.cardTitle}>{post.title}</h3>
                <p className={b.cardExcerpt}>{post.excerpt}</p>
                <div className={b.cardFoot}>
                  <span>{post.authorName}</span>
                  <span className={b.cardReadCta}>
                    مطالعه مقاله
                    <Icon name="arrow_back" size={15} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
