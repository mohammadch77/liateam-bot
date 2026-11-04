import type { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { catalogService, parseListParams, type RawSearchParams } from '@/server/services/catalog.service';
import { Breadcrumb, Button, Container, ProductCard, ProductGrid, TextField } from '@/ui';
import { SearchGroups } from '@/app/(site)/_catalog/SearchGroups';
import { CatalogListing, CatalogUnavailable, NoResults } from '@/app/(site)/_catalog/CatalogListing';
import { redirectPastEnd } from '@/app/(site)/_catalog/listing-url';
import s from '@/app/(site)/_catalog/catalog.module.css';
import { searchPath } from '@/lib/urls';

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
  const raw = await searchParams;
  const params = parseListParams(raw);
  // «جست‌وجو» with nothing asked (the tab bar's link before the page's scripts ran, or without them): a search page with the field
  // ready and the main categories, not the whole catalogue. Links that want the catalogue carry a sort or a filter.
  const landing = !params.q && Object.keys(raw).length === 0;
  if (landing) return <SearchLanding />;
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
  redirectPastEnd(searchPath(), data.listing);
  // the categories and brands the query matched, above the products (the first page only); nothing found: a way on
  const groups = params.q && data.listing.page === 1 ? await catalogService.searchGroups(params.q, { categories: 6, brands: 6 }).catch(() => null) : null;
  const nothing = data.listing.items.length === 0 && !groups?.categories.length && !groups?.brands.length;
  const fallback = params.q && nothing ? await catalogService.searchFallback().catch(() => null) : null;
  const fallbackViews = fallback ? await catalogService.fallbackViews(4).catch(() => []) : [];

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: browseAll ? 'همه‌ی محصولات' : 'جست‌وجو' }]}
      />
      <header className={s.head}>
        <h1 className={s.title}>{browseAll ? 'همه‌ی محصولات' : `نتایج «${params.q}»`}</h1>
      </header>

      <form action={searchPath()} method="get" role="search" className={s.searchForm}>
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

      {groups && (
        <>
          <SearchGroups title="دسته‌بندی‌های مرتبط" items={groups.categories} kind="category" chips />
          <SearchGroups title="برندهای مرتبط" items={groups.brands} kind="brand" chips />
        </>
      )}

      <CatalogListing
        basePath={searchPath()}
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
                ? `${searchPath()}${params.q ? `?q=${encodeURIComponent(params.q)}` : ''}`
                : undefined
            }
          />
        }
      />

      {fallback && (
        <>
          <SearchGroups title="دسته‌بندی‌های پیشنهادی" items={fallback.categories} kind="category" />
          {fallbackViews.length > 0 && (
            <section aria-label="محصولات پیشنهادی" data-search-fallback>
              <h2 className={s.title}>محصولات پیشنهادی</h2>
              <ProductGrid>
                {fallbackViews.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </ProductGrid>
            </section>
          )}
        </>
      )}
    </Container>
  );
}

/** The search page with nothing asked yet: the field focused, the main categories, a few products in stock. */
async function SearchLanding() {
  const [fallback, views] = await Promise.all([
    catalogService.searchFallback().catch(() => null),
    catalogService.fallbackViews(4).catch(() => []),
  ]);
  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'جست‌وجو' }]} />
      <header className={s.head}>
        <h1 className={s.title}>جست‌وجو</h1>
      </header>
      <form action={searchPath()} method="get" role="search" className={s.searchForm} data-search-landing>
        <TextField
          name="q"
          type="search"
          label="جست‌وجو در محصولات، برندها و دسته‌ها"
          placeholder="مثلاً سرم، شامپو، ضدآفتاب…"
          maxLength={80}
          enterKeyHint="search"
          autoFocus
        />
        <div style={{ alignSelf: 'flex-end' }}>
          <Button type="submit" icon="search">
            جست‌وجو
          </Button>
        </div>
      </form>
      {fallback && <SearchGroups title="دسته‌بندی‌ها" items={fallback.categories} kind="category" />}
      {views.length > 0 && (
        <section aria-label="محصولات پیشنهادی">
          <h2 className={s.title}>تازه‌ها</h2>
          <ProductGrid>
            {views.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ProductGrid>
        </section>
      )}
    </Container>
  );
}
