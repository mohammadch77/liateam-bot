import type { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { catalogService, parseListParams, type RawSearchParams } from '@/server/services/catalog.service';
import { Breadcrumb, Button, Container, TextField } from '@/ui';
import { CatalogListing, CatalogUnavailable, NoResults } from '../_catalog/CatalogListing';
import s from '../_catalog/catalog.module.css';

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = parseListParams(await searchParams);
  const brand = getConfig().BRAND_NAME;
  return {
    title: q ? `جست‌وجوی «${q}» | ${brand}` : `همه‌ی محصولات | ${brand}`,
    robots: { index: false, follow: true }, // result pages are not indexed; product and category pages are
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const params = parseListParams(await searchParams);
  // No query: the full catalog (used by «جدیدترین» / «منتخب» links), still filterable and sortable.
  const browseAll = !params.q;

  let data: Awaited<ReturnType<typeof catalogService.search>>;
  try {
    data = await catalogService.search(params, { browseAll });
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
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: browseAll ? 'همه‌ی محصولات' : 'جست‌وجو' }]}
      />
      <header className={s.head}>
        <h1 className={s.title}>{browseAll ? 'همه‌ی محصولات' : `نتایج «${params.q}»`}</h1>
      </header>

      <form action="/search" method="get" role="search" className={s.searchForm}>
        <TextField
          name="q"
          type="search"
          label="جست‌وجو در محصولات"
          defaultValue={params.q}
          placeholder="مثلاً سرم، شامپو، ضدآفتاب…"
          maxLength={80}
          enterKeyHint="search"
        />
        <div style={{ alignSelf: 'flex-end' }}>
          <Button type="submit" icon="search">
            جست‌وجو
          </Button>
        </div>
      </form>

      <CatalogListing
        basePath="/search"
        listing={data.listing}
        filterCategories={topLevel}
        filterTitle="دسته‌بندی"
        keep={params.q ? { q: params.q } : {}}
        empty={
          <NoResults
            title={browseAll ? 'محصولی برای نمایش نیست' : `نتیجه‌ای برای «${params.q}» پیدا نشد`}
            hint="املای عبارت را بررسی کنید یا کلمه‌ی کوتاه‌تری جست‌وجو کنید."
            clearHref={
              params.cat || params.inStock
                ? `/search${params.q ? `?q=${encodeURIComponent(params.q)}` : ''}`
                : undefined
            }
          />
        }
      />
    </Container>
  );
}
