import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatNumber } from '@/lib/format/number';
import {
  OFFER_SORTS,
  catalogService,
  type OfferSort,
  type RawSearchParams,
} from '@/server/services/catalog.service';
import { Breadcrumb, Container, EmptyState, Pagination, ProductCard, ProductGrid } from '@/ui';
import { CatalogUnavailable } from '../_catalog/CatalogListing';
import s from '../_catalog/catalog.module.css';

type Props = { searchParams: Promise<RawSearchParams> };

const params = z.object({
  sort: z.enum(['discount', 'cheapest', 'newest']).catch('discount'),
  page: z.coerce.number().int().min(1).max(500).catch(1),
  campaign: z.coerce.number().int().positive().optional().catch(undefined),
});

export async function generateMetadata(): Promise<Metadata> {
  const brand = getConfig().BRAND_NAME;
  return {
    title: `تخفیفات ویژه | ${brand}`,
    description: `محصولات آرایشی و بهداشتی اصل با تخفیف ویژه در ${brand}؛ قیمت قبل و بعد از تخفیف، ارسال به سراسر ایران.`,
    alternates: { canonical: '/offers' },
  };
}

function hrefFor(q: { sort: OfferSort; page?: number; campaign?: number }): string {
  const sp = new URLSearchParams();
  if (q.sort !== 'discount') sp.set('sort', q.sort);
  if (q.campaign !== undefined) sp.set('campaign', String(q.campaign));
  if (q.page && q.page > 1) sp.set('page', String(q.page));
  const qs = sp.toString();
  return qs ? `/offers?${qs}` : '/offers';
}

/** «تخفیفات ویژه»: every product with a running discount; sort, campaign filter and paging work without JavaScript. */
export default async function OffersPage({ searchParams }: Props) {
  const q = params.parse(await searchParams);
  let data: Awaited<ReturnType<typeof catalogService.offers>>;
  try {
    data = await catalogService.offers(q);
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'تخفیفات ویژه' }]} />
      <header className={s.head}>
        <h1 className={s.title}>تخفیفات ویژه</h1>
        <span className={s.sub}>{formatNumber(data.total)} محصول</span>
      </header>

      <nav aria-label="مرتب‌سازی" className={s.subcats}>
        {OFFER_SORTS.map((o) => (
          <Link
            key={o.value}
            href={hrefFor({ sort: o.value, campaign: q.campaign })}
            className={s.subcat}
            aria-current={o.value === q.sort ? 'true' : undefined}
          >
            {o.label}
          </Link>
        ))}
      </nav>
      {data.campaigns.length > 0 && (
        <nav aria-label="کمپین‌ها" className={s.subcats}>
          <Link
            href={hrefFor({ sort: q.sort })}
            className={s.subcat}
            aria-current={q.campaign === undefined ? 'true' : undefined}
          >
            همه‌ی تخفیف‌ها
          </Link>
          {data.campaigns.map((c) => (
            <Link
              key={c.id}
              href={hrefFor({ sort: q.sort, campaign: c.id })}
              className={s.subcat}
              aria-current={q.campaign === c.id ? 'true' : undefined}
            >
              {c.title}
            </Link>
          ))}
        </nav>
      )}

      {data.items.length === 0 ? (
        <EmptyState icon="bolt" title="فعلاً محصول تخفیف‌داری نداریم.">
          تخفیف‌های تازه به‌زودی همین‌جا می‌آیند؛ تا آن موقع سری به همه‌ی محصولات بزنید.
        </EmptyState>
      ) : (
        <>
          <ProductGrid>
            {data.items.map((p, i) => (
              <ProductCard key={p.id} product={p} priority={i < 2} />
            ))}
          </ProductGrid>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            hrefFor={(page) => hrefFor({ sort: q.sort, campaign: q.campaign, page })}
          />
        </>
      )}
    </Container>
  );
}
