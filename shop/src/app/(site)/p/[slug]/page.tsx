import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache, type ReactNode } from 'react';
import { getConfig } from '@/lib/config';
import { idFromSlug } from '@/lib/catalog-urls';
import { toAppError } from '@/lib/errors';
import { formatTomanText, tomanToRial } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import {
  catalogService,
  type DescriptionBlock,
  type ProductContent,
} from '@/server/services/catalog.service';
import { REVIEW_POLICY } from '@/server/services/review.service';
import { getCurrentUser } from '@/server/services/session.service';
import { Badge, Breadcrumb, Button, Container, Icon, Price, ProductCard, ProductGrid, Section } from '@/ui';
import { CatalogUnavailable } from '../../_catalog/CatalogListing';
import { Gallery } from './Gallery';
import { ReviewForm } from './ReviewForm';
import s from './product.module.css';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const loadProduct = cache(async (id: number) => catalogService.product(id));

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' });
const dayFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = idFromSlug((await params).slug);
  if (id === null) return {};
  const data = await loadProduct(id).catch(() => null);
  if (!data) return { title: 'محصول' };
  const { product: p } = data;
  const brand = getConfig().BRAND_NAME;
  return {
    title: `${p.name} | ${brand}`,
    description: `خرید ${p.name}${p.brandName ? ` از برند ${p.brandName}` : ''}، اصل با قیمت ${formatTomanText(p.priceToman)} از ${brand}.`,
    alternates: { canonical: p.href },
    openGraph: { title: p.name, images: p.imageUrl ? [{ url: p.imageUrl }] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  // ?img=N: the gallery photo chosen without JavaScript (thumbnail links)
  const imgParam = Number((await searchParams)?.img);
  const imageIndex = Number.isInteger(imgParam) && imgParam >= 1 && imgParam <= 50 ? imgParam - 1 : 0;
  const id = idFromSlug(slug);
  if (id === null) notFound();

  let data: Awaited<ReturnType<typeof loadProduct>>;
  try {
    data = await loadProduct(id);
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }
  if (!data) notFound();
  const { product: p, description, content: c, trail, related } = data;
  const user = await getCurrentUser().catch(() => null);

  const main = p.categories[0];
  const out = p.stock === 'out';
  const firstParagraph = description.find((b) => b.kind === 'paragraph');
  // Product structured data for search engines. schema.org needs an ISO 4217 code: IRR (rial), so the stored
  // toman price is converted at this edge only.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: String(p.id),
    category: main?.name,
    brand: p.brandName ? { '@type': 'Brand', name: p.brandName } : undefined,
    description:
      firstParagraph?.kind === 'paragraph' ? firstParagraph.lines.join(' ').slice(0, 300) : undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'IRR',
      price: tomanToRial(p.priceToman),
      availability: out ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    },
  };

  // Sections with content only: a tab without data is never shown.
  const hasIntro =
    description.length > 0 || c.summary.length > 0 || c.features.length > 0 || !!c.videoEmbedUrl;
  const tabs = [
    hasIntro && { id: 'intro', label: 'معرفی' },
    c.attributes.length > 0 && { id: 'specs', label: 'مشخصات' },
    c.howToUse.length > 0 && { id: 'how', label: 'نحوه مصرف' },
    c.faqs.length > 0 && { id: 'faq', label: 'پرسش‌های متداول' },
    { id: 'reviews', label: c.reviewsTotal ? `دیدگاه‌ها (${toFaDigits(c.reviewsTotal)})` : 'دیدگاه‌ها' },
  ].filter((t): t is { id: string; label: string } => !!t);

  return (
    <Container className={s.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          ...trail.map((t) => ({ label: t.name, href: t.href })),
          { label: p.name },
        ]}
      />

      <article className={s.product}>
        <Gallery images={c.images} initial={imageIndex} name={p.name} out={out} />

        <div className={s.info}>
          {/* brand when the sync bot has read it from the product page, otherwise the main category */}
          {p.brandName ? (
            <span className={s.category}>{p.brandName}</span>
          ) : (
            main && (
              <Link href={main.href} className={s.category}>
                {main.name}
              </Link>
            )
          )}
          <h1 className={s.name}>{p.name}</h1>

          <div className={s.badges}>
            {out ? (
              <Badge tone="outOfStock" />
            ) : p.stock === 'limited' ? (
              <Badge tone="limited" />
            ) : (
              <Badge tone="inStock" />
            )}
            <Badge tone="genuine" />
          </div>
          {c.recommendPercent !== null && (
            <a href="#reviews" className={s.recommendLink}>
              <Icon name="check_circle" size={18} />
              {toFaDigits(c.recommendPercent)}٪ از خریداران این کالا را پیشنهاد کرده‌اند
            </a>
          )}

          <div className={s.buyBox}>
            {out ? (
              <>
                <p className={s.outText}>این کالا در حال حاضر موجود نیست.</p>
                <Button variant="outline" icon="notifications" disabled block>
                  خبرم کن (به‌زودی)
                </Button>
              </>
            ) : (
              <>
                <Price toman={p.priceToman} size="lg" />
                {/* cart slot: the cart arrives in phase 2 */}
                <Button size="lg" block icon="add_shopping_cart" disabled aria-describedby="cart-soon">
                  افزودن به سبد
                </Button>
                <span id="cart-soon" className={s.soon}>
                  خرید آنلاین به‌زودی فعال می‌شود.
                </span>
              </>
            )}
            <ul className={s.facts}>
              <li>
                <Icon name="verified" size={19} className={s.factIcon} />
                ضمانت اصالت؛ مستقیم از تأمین‌کننده رسمی
              </li>
              <li>
                <Icon name="local_shipping" size={19} className={s.factIcon} />
                ارسال به سراسر ایران
              </li>
              <li>
                <Icon name="refresh" size={19} className={s.factIcon} />
                قیمت و موجودی به‌روز: {dateFa.format(p.updatedAt)}
              </li>
            </ul>
          </div>

          <dl className={s.specs} aria-label="اطلاعات کالا">
            {p.brandName && (
              <div>
                <dt>برند</dt>
                <dd>{p.brandName}</dd>
              </div>
            )}
            {p.categories.length > 0 && (
              <div>
                <dt>دسته‌بندی</dt>
                <dd>
                  {p.categories.map((cat, i) => (
                    <span key={cat.code}>
                      {i > 0 && '، '}
                      <Link href={cat.href}>{cat.name}</Link>
                    </span>
                  ))}
                </dd>
              </div>
            )}
            <div>
              <dt>کد کالا</dt>
              <dd className="tnum">{toFaDigits(p.id)}</dd>
            </div>
          </dl>
        </div>
      </article>

      {/* in-page tabs (Product Page.dc.html): anchors to the sections below, sticky while scrolling */}
      <nav className={s.tabs} aria-label="بخش‌های صفحه‌ی محصول">
        <ul>
          {tabs.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`}>{t.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className={s.sections}>
        {hasIntro && (
          <ProductSection id="intro" title="معرفی محصول">
            <div className={c.videoEmbedUrl ? s.introGrid : undefined}>
              <div className={s.prose}>
                {c.summary.length > 0 && (
                  <ul className={s.summary}>
                    {c.summary.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                <Description blocks={description} />
                {c.features.length > 0 && (
                  <ul className={s.chips} aria-label="ویژگی‌ها">
                    {c.features.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
              {c.videoEmbedUrl && (
                <figure className={s.video}>
                  {/* only Liateam's ArvanCloud player (checked on the server); sandboxed, no top navigation */}
                  <iframe
                    src={c.videoEmbedUrl}
                    title={`ویدیوی ${p.name}`}
                    loading="lazy"
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                  <figcaption>ویدیوی معرفی محصول</figcaption>
                </figure>
              )}
            </div>
          </ProductSection>
        )}

        {(c.attributes.length > 0 || c.howToUse.length > 0) && (
          <div className={s.pair}>
            {c.attributes.length > 0 && (
              <ProductSection id="specs" title="مشخصات">
                <dl className={s.attrTable}>
                  {c.attributes.map((a, i) => (
                    <div key={i}>
                      <dt>{a.key}</dt>
                      <dd>{a.value}</dd>
                    </div>
                  ))}
                </dl>
              </ProductSection>
            )}
            {c.howToUse.length > 0 && (
              <ProductSection id="how" title="نحوه مصرف">
                <ol className={s.steps}>
                  {c.howToUse.map((line, i) => (
                    <li key={i}>
                      <span className={s.stepNo} aria-hidden="true">
                        {toFaDigits(i + 1)}
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>
              </ProductSection>
            )}
          </div>
        )}

        {c.faqs.length > 0 && (
          <ProductSection id="faq" title="پرسش‌های متداول">
            <div className={s.faqList}>
              {c.faqs.map((f, i) => (
                <details key={i} className={s.faq}>
                  <summary>
                    {f.question}
                    <Icon name="keyboard_arrow_down" size={22} className={s.faqIcon} />
                  </summary>
                  <p>{f.answer}</p>
                </details>
              ))}
            </div>
          </ProductSection>
        )}

        <ProductSection id="reviews" title="دیدگاه خریداران">
          <Reviews content={c} productId={p.id} signedIn={!!user} returnTo={p.href} />
        </ProductSection>
      </div>

      {related.length > 0 && (
        <Section
          id="related"
          title="محصولات مرتبط"
          action={main ? { href: main.href, label: 'مشاهده همه' } : undefined}
        >
          <ProductGrid>
            {related.map((r) => (
              <ProductCard key={r.id} product={r} />
            ))}
          </ProductGrid>
        </Section>
      )}
    </Container>
  );
}

function ProductSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={s.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={s.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Typed blocks from plain text: the supplier's HTML is never rendered. */
function Description({ blocks }: { blocks: DescriptionBlock[] }) {
  return blocks.map((b, i) =>
    b.kind === 'heading' ? (
      <h3 key={i}>{b.text}</h3>
    ) : b.kind === 'list' ? (
      <ul key={i}>
        {b.items.map((item, j) => (
          <li key={j}>{item}</li>
        ))}
      </ul>
    ) : (
      <p key={i}>
        {b.lines.map((line, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {line}
          </span>
        ))}
      </p>
    ),
  );
}

function Stars({ value, size = 17 }: { value: number; size?: number }) {
  return (
    <span className={s.starsShown} role="img" aria-label={`${toFaDigits(value)} از ۵ ستاره`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon
          key={n}
          name="star"
          size={size}
          filled={n <= value}
          className={n <= value ? s.starOn : s.starOff}
        />
      ))}
    </span>
  );
}

function Reviews({
  content: c,
  productId,
  signedIn,
  returnTo,
}: {
  content: ProductContent;
  productId: number;
  signedIn: boolean;
  returnTo: string;
}) {
  return (
    <div className={s.reviewsGrid}>
      <aside className={s.reviewsSummary}>
        {c.recommendPercent !== null && (
          <p className={s.recommend}>
            <b>{toFaDigits(c.recommendPercent)}٪</b>
            <span>از خریداران این کالا را پیشنهاد کرده‌اند</span>
          </p>
        )}
        <p className={s.reviewCount}>
          {c.reviewsTotal ? `${toFaDigits(c.reviewsTotal)} دیدگاه` : 'بدون دیدگاه'}
        </p>
        {signedIn ? (
          <ReviewForm productId={productId} maxLength={REVIEW_POLICY.maxLength} />
        ) : (
          <div className={s.loginPrompt}>
            <p>برای ثبت دیدگاه وارد حساب کاربری خود شوید.</p>
            <Button href={`/login?next=${encodeURIComponent(`${returnTo}#reviews`)}`} variant="outline" block>
              ورود و ثبت دیدگاه
            </Button>
          </div>
        )}
      </aside>
      <div className={s.reviewList}>
        {c.reviews.length === 0 ? (
          <p className={s.noReviews}>هنوز نظری ثبت نشده است. اولین نفری باشید که دیدگاه می‌نویسد.</p>
        ) : (
          c.reviews.map((r, i) => (
            <article key={i} className={s.review}>
              <header>
                <span className={s.avatar} aria-hidden="true">
                  {[...r.author][0]}
                </span>
                <span className={s.reviewMeta}>
                  <b>{r.author}</b>
                  {r.createdAt && (
                    <time dateTime={r.createdAt.toISOString()}>{dayFa.format(r.createdAt)}</time>
                  )}
                </span>
                {r.stars !== null && <Stars value={r.stars} />}
              </header>
              <p className={s.reviewBody}>{r.body}</p>
              {r.reply && (
                <div className={s.reply}>
                  <b>پاسخ فروشگاه</b>
                  <p>{r.reply}</p>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
