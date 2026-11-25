import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildTocAndAnnotatedHtml, sanitizeBlogHtml } from '@/lib/blog/seo';
import { getConfig } from '@/lib/config';
import { toFaDigits } from '@/lib/format/number';
import { siteOrigin } from '@/server/http/site-origin';
import { blogService } from '@/server/services/blog.service';
import { Breadcrumb, Container, Icon } from '@/ui';
import s from '../blog.module.css';

export const dynamic = 'force-dynamic';

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'long' });

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return dateFa.format(new Date(iso));
  } catch {
    return '';
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const found = await blogService.publicDetail(slug);
  if (!found) return { title: 'مقاله یافت نشد' };

  const { post } = found;
  const brand = getConfig().BRAND_NAME;
  const title = post.metaTitle || `${post.title} | ${brand}`;
  const description = post.metaDescription || post.excerpt;

  return {
    title,
    description,
    keywords: [post.focusKeyword, ...post.tags].filter(Boolean),
    openGraph: {
      type: 'article',
      title,
      description,
      publishedTime: post.publishedAt ?? post.createdAt,
      modifiedTime: post.updatedAt,
      authors: [post.authorName],
      tags: post.tags,
      images: post.coverImageUrl ? [{ url: post.coverImageUrl, alt: post.coverImageAlt || post.title }] : undefined,
    },
  };
}

export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const found = await blogService.publicDetail(slug);
  if (!found) notFound();

  const { post, related } = found;
  const origin = await siteOrigin();
  const brand = getConfig().BRAND_NAME;
  const safeHtml = sanitizeBlogHtml(post.contentHtml);
  const { html, headings } = buildTocAndAnnotatedHtml(safeHtml);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.metaDescription || post.excerpt,
    image: post.coverImageUrl ? [post.coverImageUrl.startsWith('http') ? post.coverImageUrl : `${origin}${post.coverImageUrl}`] : undefined,
    author: { '@type': 'Person', name: post.authorName },
    publisher: { '@type': 'Organization', name: brand },
    datePublished: post.publishedAt ?? post.createdAt,
    dateModified: post.updatedAt,
    keywords: [post.focusKeyword, ...post.tags].filter(Boolean).join(', '),
    mainEntityOfPage: `${origin}/blog/${post.slug}`,
  };

  const breadcrumbItems = [
    { label: 'خانه', href: '/' },
    { label: 'وبلاگ', href: '/blog' },
    ...(post.categoryName && post.categorySlug
      ? [{ label: post.categoryName, href: `/blog?category=${encodeURIComponent(post.categorySlug)}` }]
      : []),
    { label: post.title },
  ];

  return (
    <Container>
      <div className={s.page} data-blog-detail>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        <Breadcrumb items={breadcrumbItems} />

        <div className={s.articleLayout}>
          <article className={s.articleMain}>
            <header className={s.articleHead}>
              {post.categoryName && post.categorySlug && (
                <Link href={`/blog?category=${encodeURIComponent(post.categorySlug)}`} className={s.kicker}>
                  <span className={s.kickerDot} aria-hidden="true" />
                  {post.categoryName}
                </Link>
              )}

              <h1 className={s.articleTitle}>{post.title}</h1>
              {post.excerpt && <p className={s.articleExcerpt}>{post.excerpt}</p>}

              <div className={s.articleMetaBar}>
                <span>نویسنده: <strong>{post.authorName}</strong></span>
                <span className={s.metaDot}>•</span>
                <span>انتشار: <strong>{fmtDate(post.publishedAt || post.createdAt)}</strong></span>
                <span className={s.metaDot}>•</span>
                <span>زمان مطالعه: <strong>{toFaDigits(post.readingTimeMinutes)} دقیقه</strong></span>
              </div>
            </header>

            {post.coverImageUrl && (
              <div className={s.coverFrame}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.coverImageUrl}
                  alt={post.coverImageAlt || post.title}
                  className={s.coverImg}
                />
              </div>
            )}

            <div
              className={s.articleBody}
              data-blog-body
              dangerouslySetInnerHTML={{ __html: html }}
            />

            {post.tags.length > 0 && (
              <div className={s.tagsBar}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)' }}>برچسب‌ها:</span>
                {post.tags.map((tag) => (
                  <Link key={tag} href={`/blog?tag=${encodeURIComponent(tag)}`} className={s.tagPill}>
                    #{tag}
                  </Link>
                ))}
              </div>
            )}
          </article>

          <aside className={s.sidebar}>
            {headings.length > 0 && (
              <nav className={s.sideCard} aria-label="فهرست مطالب مقاله">
                <h2 className={s.sideTitle}>فهرست مطالب</h2>
                <div className={s.tocList}>
                  {headings.map((h) => (
                    <a
                      key={h.id}
                      href={`#${h.id}`}
                      className={`${s.tocLink} ${h.level === 3 ? s.tocSub : ''}`}
                    >
                      {h.text}
                    </a>
                  ))}
                </div>
              </nav>
            )}

            <div className={s.shopCtaCard}>
              <strong style={{ fontSize: 15 }}>دنبال محصولات اصل این روتین هستید؟</strong>
              <p style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.8 }}>
                تمامی محصولات آرایشی و مراقبت پوست در فروشگاه {brand} با ضمانت اصالت و ارسال سریع عرضه می‌شوند.
              </p>
              <Link href="/shop/packs" className={s.shopCtaBtn}>
                مشاهده پک‌های کاربردی
                <Icon name="arrow_back" size={16} />
              </Link>
            </div>
          </aside>
        </div>

        {related.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className={s.relatedHead}>
              <h2 className={s.relatedTitle}>مقالات مرتبط</h2>
              <Link href="/blog" className={s.homeBlogMore}>
                مشاهده همه مقالات
                <Icon name="arrow_back" size={16} />
              </Link>
            </div>
            <div className={s.grid}>
              {related.map((item) => (
                <Link key={item.id} href={`/blog/${item.slug}`} className={s.card}>
                  <div className={s.cardImgFrame}>
                    {item.coverImageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.coverImageUrl}
                        alt={item.coverImageAlt || item.title}
                        className={s.cardImg}
                        loading="lazy"
                      />
                    ) : (
                      <div className={s.cardImgPlaceholder}>
                        <Icon name="spa" size={34} />
                      </div>
                    )}
                    {item.categoryName && <span className={s.cardBadge}>{item.categoryName}</span>}
                  </div>
                  <div className={s.cardBody}>
                    <div className={s.cardMeta}>
                      <span>{fmtDate(item.publishedAt || item.createdAt)}</span>
                      <span className={s.metaDot}>•</span>
                      <span>{toFaDigits(item.readingTimeMinutes)} دقیقه مطالعه</span>
                    </div>
                    <h3 className={s.cardTitle}>{item.title}</h3>
                    <p className={s.cardExcerpt}>{item.excerpt}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </Container>
  );
}
