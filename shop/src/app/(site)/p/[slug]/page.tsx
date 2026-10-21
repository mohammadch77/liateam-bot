import type { Metadata } from 'next';
import Image from 'next/image';
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
import { ActiveTab } from './ActiveTab';
import { Gallery } from './Gallery';
import { OpenSectionOnHash } from './OpenSectionOnHash';
import { ReviewForm } from './ReviewForm';
import s from './product.module.css';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const loadProduct = cache(async (id: number) => catalogService.product(id));

const dayFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

/**
 * One fixed template for every product (Product Page.dc.html), whatever Liateam filled in: the same five sections
 * in the same place, each with a same-shaped empty state; long text and long lists are folded, never dropped.
 */
const LIMITS = {
  /** key features in the card at the top */
  keyFeatures: 5,
  /** spec rows shown before «همه‌ی مشخصات» */
  specs: 8,
  faqs: 5,
  reviews: 4,
  /** a text longer than this (characters) is folded at ~8 lines with «نمایش بیشتر» */
  foldAt: 300,
} as const;

/**
 * Our own general care note under «نحوه مصرف», the same for every product (not Liateam's text; listed in
 * docs/phase1-handover.md). It makes no claim about a particular product or its packaging.
 */
const CARE_NOTE =
  'پیش از نخستین مصرف، محصول را روی ناحیه‌ی کوچکی از پوست امتحان کنید. در صورت بروز قرمزی، خارش یا سوزش، مصرف را قطع کنید و با پزشک مشورت کنید. دور از دسترس کودکان نگهداری شود.';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = idFromSlug((await params).slug);
  if (id === null) return {};
  const data = await loadProduct(id).catch(() => null);
  if (!data) return { title: 'محصول' };
  const { product: p, content: c } = data;
  const site = getConfig().BRAND_NAME;
  // our own wording from name + brand + size (Liateam's meta texts are kept by the bot but never used here)
  const label = [p.name, c.size].filter(Boolean).join('، ');
  return {
    title: `${p.name} | ${site}`,
    description: `خرید ${label}${p.brandName ? ` از برند ${p.brandName}` : ''}؛ اصل، با قیمت ${formatTomanText(p.priceToman)} و ارسال به سراسر ایران از ${site}.`,
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
  const { product: p, brand, description, content: c, trail, related } = data;
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

  // key features: the summary lines first (Liateam's headline points), then the other features; one product has neither
  const keyFeatures = [...new Set([...c.summary, ...c.features])].slice(0, LIMITS.keyFeatures);
  const descriptionLength = description.reduce(
    (n, b) =>
      n +
      (b.kind === 'paragraph'
        ? b.lines.join(' ').length
        : b.kind === 'list'
          ? b.items.join(' ').length
          : b.text.length),
    0,
  );
  const howLength = c.howToUse.join(' ').length;
  // beside «مشخصات»: the video, else the second gallery photo (else the first); with neither, «مشخصات» is full width
  const sidePhoto = c.images[1] ?? c.images[0] ?? null;
  const hasMedia = !!c.videoEmbedUrl || !!sidePhoto;
  // the key facts, only those the product has (no «نامشخص» rows)
  const quickSpecs: Array<{ key: string; value: ReactNode }> = [
    { key: 'برند', value: brand ? <Link href={brand.href}>{brand.name}</Link> : (p.brandName ?? null) },
    { key: 'حجم', value: c.size },
    { key: 'کشور سازنده', value: c.country },
    { key: 'مدت اعتبار', value: c.expireMonths ? `${toFaDigits(c.expireMonths)} ماه پس از تولید` : null },
  ].filter((q) => q.value);

  const tabs = [
    { id: 'intro', label: 'معرفی' },
    { id: 'specs', label: 'مشخصات' },
    // only when there really is a video (a gallery photo in its place gets no tab and no heading)
    ...(c.videoEmbedUrl ? [{ id: 'video', label: 'ویدیو' }] : []),
    { id: 'how', label: 'نحوه مصرف' },
    { id: 'faq', label: c.faqs.length ? `پرسش‌ها (${toFaDigits(c.faqs.length)})` : 'پرسش‌ها' },
    { id: 'reviews', label: c.reviewsTotal ? `دیدگاه‌ها (${toFaDigits(c.reviewsTotal)})` : 'دیدگاه‌ها' },
  ];

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

      {/* ── top: gallery | information | buy box ── */}
      <article className={s.product}>
        <Gallery images={c.images} initial={imageIndex} name={p.name} out={out} tint={c.color} />

        <div className={s.info}>
          <div className={s.chipsRow}>
            {brand ? (
              <Link href={brand.href} className={s.brandChip}>
                {brand.name}
              </Link>
            ) : (
              p.brandName && <span className={s.brandChip}>{p.brandName}</span>
            )}
            {main && (
              <Link href={main.href} className={s.categoryLink}>
                {main.name}
              </Link>
            )}
          </div>
          <h1 className={s.name}>{p.name}</h1>

          <p className={s.ratingLine}>
            {c.recommendPercent !== null && (
              <a href="#reviews" className={s.ratingStrong}>
                <Icon name="check_circle" size={17} />
                {toFaDigits(c.recommendPercent)}٪ پیشنهاد
              </a>
            )}
            <a href="#reviews">{toFaDigits(c.reviewsTotal)} دیدگاه</a>
            <a href="#faq">{toFaDigits(c.faqs.length)} پرسش</a>
          </p>

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

          <section className={s.card} aria-labelledby="key-features">
            <h2 id="key-features" className={s.cardTitle}>
              ویژگی‌های کلیدی
            </h2>
            {keyFeatures.length > 0 ? (
              <ul className={s.checks}>
                {keyFeatures.map((f, i) => (
                  <li key={i}>
                    <Icon name="check_circle" size={18} className={s.checkIcon} />
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.muted}>ویژگی‌ای برای این محصول ثبت نشده است.</p>
            )}
            {c.concerns.length > 0 && (
              <p className={s.concerns}>
                <span>مناسب برای:</span>
                {c.concerns.map((x) => (
                  <span key={x} className={s.concern}>
                    {x}
                  </span>
                ))}
              </p>
            )}
          </section>

          {quickSpecs.length > 0 && (
            <dl className={`${s.card} ${s.quickSpecs}`} aria-label="مشخصات سریع">
              {quickSpecs.map((q) => (
                <div key={q.key}>
                  <dt>{q.key}</dt>
                  <dd>{q.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <aside className={s.buyBox} aria-label="خرید">
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
              ضمانت اصالت کالا
            </li>
            <li>
              <Icon name="local_shipping" size={19} className={s.factIcon} />
              ارسال به سراسر ایران
            </li>
          </ul>
          <span className={s.code}>کد کالا: {toFaDigits(p.id)}</span>
        </aside>
      </article>

      {/* phones: price + button stay at the bottom while scrolling (above the tab bar) */}
      <div className={s.stickyBuy} aria-hidden="true">
        {out ? <span className={s.outText}>ناموجود</span> : <Price toman={p.priceToman} />}
        <Button size="md" icon="add_shopping_cart" disabled tabIndex={-1}>
          افزودن به سبد
        </Button>
      </div>

      {/* in-page tabs: always the same five, sticky while scrolling (desktop) */}
      <nav className={s.tabs} aria-label="بخش‌های صفحه‌ی محصول" data-tabs>
        <ul>
          {tabs.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`}>{t.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <OpenSectionOnHash />
      <ActiveTab />
      <div className={s.sections}>
        <ProductSection id="intro" title="معرفی محصول" open>
          <div className={s.prose}>
            <Fold long={descriptionLength > LIMITS.foldAt}>
              {description.length > 0 ? (
                <Description blocks={description} />
              ) : (
                <p>توضیحی برای این محصول ثبت نشده است.</p>
              )}
            </Fold>
          </div>
        </ProductSection>

        <div className={hasMedia ? s.pair : undefined}>
          <ProductSection id="specs" title="مشخصات">
            {c.attributes.length > 0 ? (
              <>
                <AttrTable rows={c.attributes.slice(0, LIMITS.specs)} />
                {c.attributes.length > LIMITS.specs && (
                  <details className={s.more}>
                    <summary>
                      همه‌ی مشخصات ({toFaDigits(c.attributes.length)})
                      <Icon name="keyboard_arrow_down" size={20} className={s.moreIcon} />
                    </summary>
                    <AttrTable rows={c.attributes.slice(LIMITS.specs)} />
                  </details>
                )}
              </>
            ) : (
              <EmptyNote>مشخصاتی برای این محصول ثبت نشده است.</EmptyNote>
            )}
          </ProductSection>
          {c.videoEmbedUrl ? (
            <ProductSection id="video" title="ویدیو معرفی محصول">
              <figure className={s.media} data-media="video">
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
              </figure>
            </ProductSection>
          ) : (
            sidePhoto && (
              <figure
                className={s.media}
                data-media="photo"
                style={c.color ? { ['--tint' as string]: c.color } : undefined}
              >
                <span className={s.mediaPhoto}>
                  <Image
                    src={sidePhoto.url}
                    alt={sidePhoto.alt}
                    fill
                    sizes="(min-width: 1024px) 50vw, 92vw"
                  />
                </span>
              </figure>
            )
          )}
        </div>

        <ProductSection id="how" title="نحوه مصرف">
          {c.howToUse.length > 0 ? (
            <Fold long={howLength > LIMITS.foldAt}>
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
            </Fold>
          ) : (
            <EmptyNote>اطلاعات تکمیلی برای این محصول ثبت نشده است.</EmptyNote>
          )}
          <p className={s.careNote} role="note">
            <Icon name="warning" size={19} />
            {CARE_NOTE}
          </p>
        </ProductSection>

        <ProductSection id="faq" title="پرسش‌های متداول">
          {c.faqs.length > 0 ? (
            <div className={s.faqList}>
              {c.faqs.slice(0, LIMITS.faqs).map((f, i) => (
                <Faq key={i} question={f.question} answer={f.answer} />
              ))}
              {c.faqs.length > LIMITS.faqs && (
                <details className={s.more}>
                  <summary>
                    نمایش همه‌ی {toFaDigits(c.faqs.length)} پرسش
                    <Icon name="keyboard_arrow_down" size={20} className={s.moreIcon} />
                  </summary>
                  <div className={s.faqList}>
                    {c.faqs.slice(LIMITS.faqs).map((f, i) => (
                      <Faq key={i} question={f.question} answer={f.answer} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <EmptyNote>
              پرسشی برای این محصول ثبت نشده است. <Link href="/contact">سؤالی دارید؟ با ما در تماس باشید</Link>
            </EmptyNote>
          )}
        </ProductSection>

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

/**
 * A section of the page. On phones it is an accordion (native <details>: «معرفی» open, the others folded); from
 * 1024 px it is always open and its heading is just a heading (product.module.css).
 */
function ProductSection({
  id,
  title,
  open = false,
  children,
}: {
  id: string;
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} className={s.section} open={open} data-section={id}>
      <summary className={s.sectionHead}>
        <h2 className={s.sectionTitle}>{title}</h2>
        <Icon name="keyboard_arrow_down" size={24} className={s.sectionIcon} />
      </summary>
      <div className={s.sectionBody}>{children}</div>
    </details>
  );
}

/** Long text folded at ~8 lines; «نمایش بیشتر» unfolds it (no JavaScript; the whole text is in the page). */
function Fold({ long, children }: { long: boolean; children: ReactNode }) {
  if (!long) return <div className={s.foldBody}>{children}</div>;
  return (
    <div className={s.fold}>
      <div className={s.foldBody}>{children}</div>
      <details className={s.foldToggle}>
        <summary>
          <span className={s.foldMore}>نمایش بیشتر</span>
          <span className={s.foldLess}>نمایش کمتر</span>
          <Icon name="keyboard_arrow_down" size={20} className={s.moreIcon} />
        </summary>
      </details>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className={s.emptyNote}>{children}</p>;
}

function AttrTable({ rows }: { rows: Array<{ key: string; value: string }> }) {
  return (
    <dl className={s.attrTable}>
      {rows.map((a, i) => (
        <div key={i}>
          <dt>{a.key}</dt>
          <dd>{a.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  return (
    <details className={s.faq}>
      <summary>
        {question}
        <Icon name="keyboard_arrow_down" size={22} className={s.faqIcon} />
      </summary>
      <p>{answer}</p>
    </details>
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

type ReviewItem = ProductContent['reviews'][number];

function ReviewCard({ r }: { r: ReviewItem }) {
  return (
    <article className={s.review}>
      <header>
        <span className={s.avatar} aria-hidden="true">
          {[...r.author][0]}
        </span>
        <span className={s.reviewMeta}>
          <b>{r.author}</b>
          {r.createdAt && <time dateTime={r.createdAt.toISOString()}>{dayFa.format(r.createdAt)}</time>}
        </span>
        {r.stars !== null && <Stars value={r.stars} />}
      </header>
      <p className={s.reviewBody}>{r.body}</p>
      {r.reply && (
        <details className={s.reply}>
          <summary>پاسخ فروشگاه</summary>
          <p>{r.reply}</p>
        </details>
      )}
    </article>
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
  const first = c.reviews.slice(0, LIMITS.reviews);
  const rest = c.reviews.slice(LIMITS.reviews);
  return (
    <div className={s.reviewsGrid}>
      <aside className={s.reviewsSummary}>
        <p className={s.recommend}>
          <b>{c.recommendPercent !== null ? `${toFaDigits(c.recommendPercent)}٪` : '—'}</b>
          <span>
            از خریداران این کالا را پیشنهاد کرده‌اند
            <br />
            {c.reviewsTotal ? `${toFaDigits(c.reviewsTotal)} دیدگاه` : 'بدون دیدگاه'}
          </span>
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
        {first.length === 0 ? (
          <EmptyNote>هنوز دیدگاهی ثبت نشده است؛ اولین نفر باشید.</EmptyNote>
        ) : (
          first.map((r, i) => <ReviewCard key={i} r={r} />)
        )}
        {rest.length > 0 && (
          <details className={s.more}>
            <summary>
              مشاهده‌ی همه‌ی دیدگاه‌ها ({toFaDigits(c.reviews.length)})
              <Icon name="keyboard_arrow_down" size={20} className={s.moreIcon} />
            </summary>
            <div className={s.reviewList}>
              {rest.map((r, i) => (
                <ReviewCard key={i} r={r} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
