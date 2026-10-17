import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getConfig } from '@/lib/config';
import { idFromSlug } from '@/lib/catalog-urls';
import { toAppError } from '@/lib/errors';
import { formatTomanText, tomanToRial } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { catalogService } from '@/server/services/catalog.service';
import { Badge, Breadcrumb, Button, Container, Icon, Price, ProductCard, ProductGrid, Section } from '@/ui';
import { CatalogUnavailable } from '../../_catalog/CatalogListing';
import s from './product.module.css';

type Props = { params: Promise<{ slug: string }> };

const loadProduct = cache(async (id: number) => catalogService.product(id));

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' });

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

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
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
  const { product: p, description, trail, related } = data;

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

  return (
    <Container className={s.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          ...trail.map((c) => ({ label: c.name, href: c.href })),
          { label: p.name },
        ]}
      />

      <article className={s.product}>
        <div className={s.gallery}>
          <div className={out ? `${s.stage} ${s.out}` : s.stage}>
            <span className={s.pedestal} aria-hidden="true" />
            {p.imageUrl ? (
              <span className={s.image}>
                <Image src={p.imageUrl} alt={p.name} fill priority sizes="(min-width: 1024px) 560px, 92vw" />
              </span>
            ) : (
              <span className={s.noImage} role="img" aria-label="بدون عکس">
                <Icon name="spa" size={96} />
              </span>
            )}
          </div>
        </div>

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

          {p.categories.length > 0 && (
            <section className={s.details} aria-labelledby="details-title">
              <h2 id="details-title" className={s.detailsTitle}>
                مشخصات
              </h2>
              <dl className={s.specs}>
                {p.brandName && (
                  <div>
                    <dt>برند</dt>
                    <dd>{p.brandName}</dd>
                  </div>
                )}
                <div>
                  <dt>دسته‌بندی</dt>
                  <dd>
                    {p.categories.map((c, i) => (
                      <span key={c.code}>
                        {i > 0 && '، '}
                        <Link href={c.href}>{c.name}</Link>
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>کد کالا</dt>
                  <dd className="tnum">{toFaDigits(p.id)}</dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      </article>

      {description.length > 0 && (
        <section className={s.description} aria-labelledby="description-title">
          <h2 id="description-title" className={s.detailsTitle}>
            توضیحات
          </h2>
          {/* typed blocks from plain text: the supplier's HTML is never rendered */}
          <div className={s.prose}>
            {description.map((b, i) =>
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
            )}
          </div>
        </section>
      )}

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
