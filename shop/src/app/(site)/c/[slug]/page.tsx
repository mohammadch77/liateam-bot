import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getConfig } from '@/lib/config';
import { idFromSlug } from '@/lib/catalog-urls';
import { toAppError } from '@/lib/errors';
import { formatNumber } from '@/lib/format/number';
import { catalogService, parseListParams, type RawSearchParams } from '@/server/services/catalog.service';
import { Breadcrumb, Container } from '@/ui';
import { CatalogListing, CatalogUnavailable, NoResults } from '../../_catalog/CatalogListing';
import s from '../../_catalog/catalog.module.css';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

// metadata and page share one lookup per request
const loadCategory = cache(async (code: number, query: string) =>
  catalogService.category(code, parseListParams(Object.fromEntries(new URLSearchParams(query)))),
);
const queryString = (sp: RawSearchParams) =>
  new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
  ).toString();

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const code = idFromSlug((await params).slug);
  if (code === null) return {};
  const data = await loadCategory(code, queryString(await searchParams)).catch(() => null);
  if (!data) return { title: 'دسته‌بندی' };
  const brand = getConfig().BRAND_NAME;
  return {
    title: `خرید ${data.category.name} | ${brand}`,
    description: `${formatNumber(data.category.count)} محصول ${data.category.name} اصل با قیمت به‌روز در ${brand}.`,
    alternates: { canonical: data.category.href },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const code = idFromSlug(slug);
  if (code === null) notFound();
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof catalogService.category>>;
  try {
    data = await loadCategory(code, queryString(sp));
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }
  if (!data) notFound();

  // (the canonical-URL check and real 404/308 status happen in layout.tsx, before streaming)
  const { category, parent, children, listing } = data;

  const crumbs = [
    { label: 'خانه', href: '/' },
    ...(parent ? [{ label: parent.name, href: parent.href }] : []),
    { label: category.name },
  ];

  return (
    <Container className={s.page}>
      <Breadcrumb items={crumbs} />
      <header className={s.head}>
        <h1 className={s.title}>{category.name}</h1>
        <span className={s.sub}>{formatNumber(category.count)} محصول</span>
      </header>

      {children.length > 0 && (
        <nav aria-label={`زیردسته‌های ${category.name}`} className={s.subcats}>
          {children.map((c) => (
            <Link key={c.code} href={c.href} className={s.subcat}>
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      <CatalogListing
        basePath={category.href}
        listing={listing}
        filterCategories={children}
        filterTitle="زیردسته"
        empty={
          <NoResults
            title="محصولی با این فیلترها نیست"
            hint="«فقط موجود» را بردارید یا زیردسته‌ی دیگری انتخاب کنید."
            clearHref={category.href}
          />
        }
      />
    </Container>
  );
}
