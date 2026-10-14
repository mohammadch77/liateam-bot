import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/format/number';
import { SORT_OPTIONS, type Category, type Listing } from '@/server/services/catalog.service';
import { Button, EmptyState, FilterChip, Pagination, ProductCard, ProductGrid, Select, Switch } from '@/ui';
import { AutoSubmit } from './AutoSubmit';
import { listingHref } from './listing-url';
import s from './catalog.module.css';

type Props = {
  /** page path without query, e.g. /c/12-مراقبت-پوست or /search */
  basePath: string;
  listing: Listing;
  /** categories offered as a filter (sub-categories on a category page, all on search) */
  filterCategories: readonly Category[];
  filterTitle: string;
  /** hidden inputs to keep (e.g. the search query) */
  keep?: Record<string, string>;
  empty: ReactNode;
};

/** Filter column + sort + product grid + pagination. Plain GET forms and links: works without JavaScript. */
export function CatalogListing({
  basePath,
  listing,
  filterCategories,
  filterTitle,
  keep = {},
  empty,
}: Props) {
  const { params } = listing;
  const activeCategory = filterCategories.find((c) => c.code === params.cat);
  const hasFilters = !!activeCategory || params.inStock === '1';

  const filters = (
    <form action={basePath} method="get" className={s.filters} aria-label="فیلترها">
      <AutoSubmit />
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {params.sort !== 'relevance' && <input type="hidden" name="sort" value={params.sort} />}

      <Switch name="inStock" value="1" defaultChecked={params.inStock === '1'}>
        فقط کالاهای موجود
      </Switch>

      {filterCategories.length > 0 && (
        <fieldset className={s.fieldset}>
          <legend className={s.legend}>{filterTitle}</legend>
          <div className={s.options}>
            {filterCategories.map((c) => (
              <label key={c.code} className={s.radio}>
                <input type="radio" name="cat" value={c.code} defaultChecked={params.cat === c.code} />
                <span>{c.name}</span>
                <span className={s.count}>{formatNumber(c.count)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className={s.filterActions}>
        <span data-nojs-submit>
          <Button type="submit" size="sm" block>
            اعمال فیلتر
          </Button>
        </span>
        {hasFilters && (
          <Button
            href={listingHref(basePath, params, { cat: undefined, inStock: undefined, page: 1 })}
            variant="ghost"
            size="sm"
          >
            پاک کردن فیلترها
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <div className={s.layout}>
      {/* phones / tablets: collapsible; laptop+: always-open side column */}
      <details className={s.filterMobile}>
        <summary className={s.filterToggle}>فیلترها{hasFilters ? ' (فعال)' : ''}</summary>
        {filters}
      </details>
      <aside className={s.sidebar} aria-label="فیلترها">
        {filters}
      </aside>

      <div className={s.results}>
        <div className={s.toolbar}>
          <span className={s.total} role="status">
            {formatNumber(listing.total)} کالا
          </span>
          <form action={basePath} method="get" className={s.sortForm}>
            <AutoSubmit />
            {Object.entries(keep).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {params.cat && <input type="hidden" name="cat" value={params.cat} />}
            {params.inStock === '1' && <input type="hidden" name="inStock" value="1" />}
            <Select
              name="sort"
              label="مرتب‌سازی"
              hideLabel
              defaultValue={params.sort}
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <span data-nojs-submit>
              <Button type="submit" variant="outline" size="sm">
                مرتب کن
              </Button>
            </span>
          </form>
        </div>

        {hasFilters && (
          <div className={s.chips}>
            {activeCategory && (
              <FilterChip removeHref={listingHref(basePath, params, { cat: undefined, page: 1 })}>
                {activeCategory.name}
              </FilterChip>
            )}
            {params.inStock === '1' && (
              <FilterChip removeHref={listingHref(basePath, params, { inStock: undefined, page: 1 })}>
                فقط موجود
              </FilterChip>
            )}
          </div>
        )}

        {listing.items.length === 0 ? (
          empty
        ) : (
          <>
            <ProductGrid withSidebar>
              {listing.items.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 4} />
              ))}
            </ProductGrid>
            <Pagination
              page={listing.page}
              totalPages={listing.totalPages}
              hrefFor={(n) => listingHref(basePath, params, { page: n })}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function NoResults({ title, hint, clearHref }: { title: string; hint: string; clearHref?: string }) {
  return (
    <EmptyState
      icon="search_off"
      tone="neutral"
      title={title}
      action={
        clearHref ? (
          <Button href={clearHref} size="sm" variant="outline">
            پاک کردن فیلترها
          </Button>
        ) : undefined
      }
    >
      {hint}
    </EmptyState>
  );
}

/** Shown instead of crashing when the catalog cannot be read (e.g. database down). */
export function CatalogUnavailable({ message }: { message: string }) {
  return (
    <div className={s.unavailable}>
      <EmptyState
        icon="wifi_off"
        tone="danger"
        title="نمایش محصولات ممکن نشد"
        action={
          <Button href="" size="sm" variant="dark" icon="refresh">
            تلاش دوباره
          </Button>
        }
      >
        {message}
      </EmptyState>
    </div>
  );
}
