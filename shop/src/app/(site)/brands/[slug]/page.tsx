import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatNumber } from '@/lib/format/number';
import { catalogService, parseListParams, type RawSearchParams } from '@/server/services/catalog.service';
import { Breadcrumb, Container } from '@/ui';
import { CatalogListing, CatalogUnavailable, NoResults } from '../../_catalog/CatalogListing';
import { redirectPastEnd } from '../../_catalog/listing-url';
import s from '../../_catalog/catalog.module.css';
import b from '../brands.module.css';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// metadata and page share one lookup per request
const loadBrand = cache(async (slug: string, query: string) =>
  catalogService.brand(slug, parseListParams(Object.fromEntries(new URLSearchParams(query)))),
);
const queryString = (sp: RawSearchParams) =>
  new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
  ).toString();

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!SLUG.test(slug)) return {};
  const data = await loadBrand(slug, queryString(await searchParams)).catch(() => null);
  if (!data) return { title: 'برند' };
  const site = getConfig().BRAND_NAME;
  return {
    title: `محصولات ${data.brand.name} | ${site}`,
    description: `${formatNumber(data.brand.count)} محصول اصل ${data.brand.name} با قیمت به‌روز در ${site}.`,
    alternates: { canonical: data.brand.href },
  };
}

/** /brands/<slug>: one brand's products (slug = the brand's Latin slug the sync bot assigns), filterable. */
export default async function BrandPage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof catalogService.brand>>;
  try {
    data = await loadBrand(slug, queryString(sp));
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }
  if (!data) notFound();
  const { brand, categories, listing } = data;
  redirectPastEnd(brand.href, listing);

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'برندها', href: '/brands' }, { label: brand.name }]}
      />
      <header className={b.brandHead}>
        {brand.logoUrl && (
          <span className={b.brandLogo}>
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo served by our own route */}
            <img src={brand.logoUrl} alt="" width={120} height={60} />
          </span>
        )}
        <div className={s.head}>
          <h1 className={s.title}>{brand.name}</h1>
          <span className={s.sub}>
            {brand.latin && <span dir="ltr">{brand.latin}</span>}
            {brand.latin && ' · '}
            {formatNumber(brand.count)} محصول
          </span>
        </div>
      </header>

      <CatalogListing
        basePath={brand.href}
        listing={listing}
        filterCategories={categories}
        filterTitle="دسته‌بندی"
        empty={
          <NoResults
            title="محصولی با این فیلترها نیست"
            hint="«فقط موجود» را بردارید یا دسته‌ی دیگری انتخاب کنید."
            clearHref={brand.href}
          />
        }
      />
    </Container>
  );
}
