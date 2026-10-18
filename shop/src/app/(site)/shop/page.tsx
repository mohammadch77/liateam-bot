import type { Metadata } from 'next';
import Link from 'next/link';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatNumber } from '@/lib/format/number';
import { catalogService, parseListParams, type RawSearchParams } from '@/server/services/catalog.service';
import { Breadcrumb, Container } from '@/ui';
import { CatalogListing, CatalogUnavailable, NoResults } from '../_catalog/CatalogListing';
import s from '../_catalog/catalog.module.css';

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata(): Promise<Metadata> {
  const brand = getConfig().BRAND_NAME;
  return {
    title: `فروشگاه | ${brand}`,
    description: `همه‌ی محصولات آرایشی، بهداشتی و مراقبتی اصل ${brand} با قیمت به‌روز و ارسال به سراسر ایران.`,
    alternates: { canonical: '/shop' },
  };
}

/** «فروشگاه»: every product on sale, with the catalog's filters, sort and paging; top categories as chips. */
export default async function ShopPage({ searchParams }: Props) {
  const params = parseListParams(await searchParams);

  let data: Awaited<ReturnType<typeof catalogService.search>>;
  try {
    data = await catalogService.search({ ...params, q: undefined }, { browseAll: true });
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }
  const topLevel = data.categories.filter((c) => c.parentCode === null);

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'فروشگاه' }]} />
      <header className={s.head}>
        <h1 className={s.title}>فروشگاه</h1>
        <span className={s.sub}>{formatNumber(data.listing.total)} محصول</span>
      </header>

      {topLevel.length > 0 && (
        <nav aria-label="دسته‌بندی محصولات" className={s.subcats}>
          {topLevel.map((c) => (
            <Link key={c.code} href={c.href} className={s.subcat}>
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      <CatalogListing
        basePath="/shop"
        listing={data.listing}
        filterCategories={topLevel}
        filterTitle="دسته‌بندی"
        empty={
          <NoResults
            title="محصولی با این فیلترها نیست"
            hint="«فقط موجود» را بردارید یا دسته‌ی دیگری انتخاب کنید."
            clearHref={params.cat || params.inStock ? '/shop' : undefined}
          />
        }
      />
    </Container>
  );
}
