import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatNumber } from '@/lib/format/number';
import { catalogService } from '@/server/services/catalog.service';
import { Breadcrumb, Container, Icon } from '@/ui';
import { CatalogUnavailable } from '../_catalog/CatalogListing';
import s from '../_catalog/catalog.module.css';
import b from './brands.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const site = getConfig().BRAND_NAME;
  return {
    title: `برندها | ${site}`,
    description: `همه‌ی برندهای اصل ${site}، با محصولات هر برند.`,
    alternates: { canonical: '/brands' },
  };
}

/** Every brand with something to sell, in Liateam's order: a product photo, the logo, name and product count. */
export default async function BrandsPage() {
  let brands: Awaited<ReturnType<typeof catalogService.brands>>;
  try {
    brands = await catalogService.brands();
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'برندها' }]} />
      <header className={s.head}>
        <h1 className={s.title}>برندها</h1>
        <span className={s.sub}>{formatNumber(brands.length)} برند</span>
      </header>
      <ul className={b.grid}>
        {brands.map((x) => (
          <li key={x.code}>
            <Link href={x.href} className={b.card}>
              <span className={b.photo}>
                {x.imageUrl ? (
                  <Image src={x.imageUrl} alt="" fill sizes="(min-width: 1024px) 320px, 45vw" />
                ) : (
                  <Icon name="spa" size={48} />
                )}
              </span>
              {/* phones and tablets: up to three product photos instead of the one large one (always three cells) */}
              <span className={b.thumbRow} aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={b.thumbCell}>
                    {x.thumbs[i] ? (
                      <Image src={x.thumbs[i]} alt="" fill sizes="64px" draggable={false} />
                    ) : (
                      <Icon name="spa" size={22} />
                    )}
                  </span>
                ))}
              </span>
              <span className={b.body}>
                {x.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- SVG logo served by our own route
                  <img src={x.logoUrl} alt="" width={96} height={40} className={b.logo} />
                )}
                <b className={b.name}>{x.name}</b>
                <span className={b.meta}>
                  {x.latin && <span dir="ltr">{x.latin}</span>}
                  <span>{formatNumber(x.count)} محصول</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
