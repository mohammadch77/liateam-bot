import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatNumber } from '@/lib/format/number';
import { catalogService } from '@/server/services/catalog.service';
import { Breadcrumb, Container, Icon } from '@/ui';
import { CatalogUnavailable } from '@/app/(site)/_catalog/CatalogListing';
import s from '@/app/(site)/_catalog/catalog.module.css';
import c from './categories.module.css';
import { categoriesPath } from '@/lib/urls';

export async function generateMetadata(): Promise<Metadata> {
  return { title: `دسته‌بندی کالاها | ${getConfig().BRAND_NAME}`, alternates: { canonical: categoriesPath() } };
}

type Cat = Awaited<ReturnType<typeof catalogService.categoriesWithCovers>>[number];

/** A category as a picture card: a product of it on the stage, its name and how many products it has. */
function CategoryCard({ cat }: { cat: Cat }) {
  return (
    <Link href={cat.href} className={c.card} data-category-card={cat.code}>
      <span className={c.photo}>
        {cat.imageUrl ? (
          <Image src={cat.imageUrl} alt="" fill sizes="(min-width: 1024px) 180px, 45vw" draggable={false} />
        ) : (
          <Icon name="spa" size={36} />
        )}
      </span>
      <span className={c.name}>{cat.name}</span>
      <span className={c.count}>{formatNumber(cat.count)} محصول</span>
    </Link>
  );
}

/**
 * «دسته‌بندی کالاها»: every parent category as its own block — its name, product count and «مشاهده‌ی همه‌ی
 * محصولات» — with a picture card for each sub-category (the cover is a product of that category, in stock and
 * newest first). A parent without sub-categories shows itself as the one card. Phones 2 columns.
 */
export default async function CategoriesPage() {
  let all: Cat[];
  try {
    all = await catalogService.categoriesWithCovers();
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }
  const codes = new Set(all.map((x) => x.code));
  const roots = all.filter((x) => x.parentCode === null || !codes.has(x.parentCode));

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'دسته‌بندی کالاها' }]} />
      <h1 className={s.title}>دسته‌بندی کالاها</h1>
      {roots.map((r) => {
        const children = all.filter((x) => x.parentCode === r.code);
        return (
          <section key={r.code} className={c.group} aria-labelledby={`cat-${r.code}`} data-category-group>
            <div className={c.groupHead}>
              <h2 id={`cat-${r.code}`} className={c.groupTitle}>
                {r.name}
                <span className={c.groupCount}>{formatNumber(r.count)} محصول</span>
              </h2>
              <Link href={r.href} className={c.all}>
                مشاهده‌ی همه‌ی محصولات
                <Icon name="arrow_back" size={18} />
              </Link>
            </div>
            <ul className={c.grid}>
              {(children.length ? children : [r]).map((ch) => (
                <li key={ch.code}>
                  <CategoryCard cat={ch} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Container>
  );
}
