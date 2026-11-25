import type { Metadata } from 'next';
import Link from 'next/link';
import { getConfig } from '@/lib/config';
import { toFaDigits } from '@/lib/format/number';
import { blogService } from '@/server/services/blog.service';
import { Breadcrumb, Container, Icon } from '@/ui';
import s from './blog.module.css';

export const dynamic = 'force-dynamic';

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return dateFa.format(new Date(iso));
  } catch {
    return '';
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const brand = getConfig().BRAND_NAME;
  return {
    title: `وبلاگ و مجله زیبایی | ${brand}`,
    description: `مقالات تخصصی مراقبت پوست، مراقبت مو، راهنمای خرید محصولات آرایشی و بهداشتی اصل و روتین‌های کاربردی در مجله ${brand}.`,
  };
}

function visiblePages(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('ellipsis');
  for (let p = start; p <= end; p += 1) out.push(p);
  if (end < total - 1) out.push('ellipsis');
  out.push(total);
  return out;
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; tag?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const category = sp.category?.trim() || undefined;
  const tag = sp.tag?.trim() || undefined;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const data = await blogService.publicIndex({ category, tag, q, page });
  const hasFilter = Boolean(category || tag || q);
  const activeCat = category ? data.categories.find((c) => c.slug === category) : null;

  const buildHref = (next: { category?: string; tag?: string; q?: string; page?: number }) => {
    const p = new URLSearchParams();
    if (next.category) p.set('category', next.category);
    if (next.tag) p.set('tag', next.tag);
    if (next.q) p.set('q', next.q);
    if (next.page && next.page > 1) p.set('page', String(next.page));
    const qs = p.toString();
    return qs ? `/blog?${qs}` : '/blog';
  };

  const rangeStart = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const rangeEnd = Math.min(data.total, data.page * data.pageSize);

  return (
    <Container>
      <div className={s.page} data-blog-index>
        <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'وبلاگ و مجله زیبایی' }]} />

        <section className={s.hero}>
          <span className={s.kicker}>
            <span className={s.kickerDot} aria-hidden="true" />
            مجله تخصصی زیبایی و سلامت پوست و مو
          </span>

          <div className={s.heroTop}>
            <div>
              <h1 className={s.heroTitle}>
                وبلاگ <span className={s.heroAccent}>{getConfig().BRAND_NAME}</span>
              </h1>
              <p className={s.heroLead}>
                راهنمای انتخاب محصولات اصل، روتین‌های مراقبت از پوست و مو، بررسی ترکیبات مؤثر و نکات تخصصی زیبایی.
              </p>
            </div>

            <form action="/blog" method="get" className={s.searchForm}>
              {category && <input type="hidden" name="category" value={category} />}
              <input
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="جستجو در مقالات وبلاگ..."
                className={s.searchInput}
                aria-label="جستجو در مقالات"
              />
              <button type="submit" className={s.searchBtn}>
                جستجو
              </button>
            </form>
          </div>

          <nav className={s.catRail} aria-label="دسته‌بندی مقالات وبلاگ">
            <Link href="/blog" className={`${s.catPill} ${!category ? s.catPillActive : ''}`}>
              همه مقالات
            </Link>
            {data.categories.map((cat) => (
              <Link
                key={cat.id}
                href={buildHref({ category: cat.slug })}
                className={`${s.catPill} ${category === cat.slug ? s.catPillActive : ''}`}
              >
                <span>{cat.name}</span>
                {typeof cat.postCount === 'number' && cat.postCount > 0 && (
                  <span className={s.catCount}>{toFaDigits(cat.postCount)}</span>
                )}
              </Link>
            ))}
          </nav>
        </section>

        {hasFilter && (
          <div className={s.activeFilterBar}>
            <span>
              نمایش {toFaDigits(data.total)} مقاله
              {activeCat ? ` در دسته «${activeCat.name}»` : ''}
              {tag ? ` با برچسب «#${tag}»` : ''}
              {q ? ` برای جستجوی «${q}»` : ''}
            </span>
            <Link href="/blog" className={s.clearFilter}>
              حذف فیلترها ×
            </Link>
          </div>
        )}

        {data.items.length === 0 ? (
          <div className={s.emptyBox}>
            <Icon name="spa" size={38} />
            <strong>مقاله‌ای با این مشخصات پیدا نشد.</strong>
            <Link href="/blog" className={s.clearFilter}>
              مشاهده همه مقالات وبلاگ
            </Link>
          </div>
        ) : (
          <div className={s.grid} data-blog-grid>
            {data.items.map((post) => (
              <Link key={post.id} href={`/blog/${post.slug}`} className={s.card} data-blog-card>
                <div className={s.cardImgFrame}>
                  {post.coverImageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={post.coverImageUrl}
                      alt={post.coverImageAlt || post.title}
                      className={s.cardImg}
                    />
                  ) : (
                    <div className={s.cardImgPlaceholder}>
                      <Icon name="spa" size={36} />
                    </div>
                  )}
                  {post.categoryName && <span className={s.cardBadge}>{post.categoryName}</span>}
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardMeta}>
                    <span>{fmtDate(post.publishedAt || post.createdAt)}</span>
                    <span className={s.metaDot}>•</span>
                    <span>{toFaDigits(post.readingTimeMinutes)} دقیقه مطالعه</span>
                  </div>
                  <h2 className={s.cardTitle}>{post.title}</h2>
                  <p className={s.cardExcerpt}>{post.excerpt}</p>
                  <div className={s.cardFoot}>
                    <span>{post.authorName}</span>
                    <span className={s.cardReadCta}>
                      مطالعه مقاله
                      <Icon name="arrow_back" size={15} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {data.totalPages > 1 && (
          <div className={s.pagerWrap} data-blog-pagination>
            <span className={s.pagerSummary}>
              نمایش {toFaDigits(rangeStart)} تا {toFaDigits(rangeEnd)} از {toFaDigits(data.total)} مقاله
            </span>
            <nav className={s.pager} aria-label="صفحه‌بندی مقالات">
              {data.page > 1 ? (
                <Link
                  href={buildHref({ category, tag, q, page: data.page - 1 })}
                  className={s.pagerBtn}
                  aria-label="صفحه قبل"
                >
                  قبلی
                </Link>
              ) : (
                <span className={`${s.pagerBtn} ${s.pagerBtnDisabled}`} aria-disabled="true">
                  قبلی
                </span>
              )}

              {visiblePages(data.page, data.totalPages).map((entry, idx) =>
                entry === 'ellipsis' ? (
                  <span key={`e-${idx}`} className={s.pagerEllipsis}>
                    …
                  </span>
                ) : (
                  <Link
                    key={entry}
                    href={buildHref({ category, tag, q, page: entry })}
                    className={`${s.pagerBtn} ${entry === data.page ? s.pagerBtnActive : ''}`}
                    aria-current={entry === data.page ? 'page' : undefined}
                  >
                    {toFaDigits(entry)}
                  </Link>
                ),
              )}

              {data.page < data.totalPages ? (
                <Link
                  href={buildHref({ category, tag, q, page: data.page + 1 })}
                  className={s.pagerBtn}
                  aria-label="صفحه بعد"
                >
                  بعدی
                </Link>
              ) : (
                <span className={`${s.pagerBtn} ${s.pagerBtnDisabled}`} aria-disabled="true">
                  بعدی
                </span>
              )}
            </nav>
          </div>
        )}
      </div>
    </Container>
  );
}
