import type { Metadata } from 'next';
import Link from 'next/link';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatNumber } from '@/lib/format/number';
import { catalogService } from '@/server/services/catalog.service';
import { Breadcrumb, Container } from '@/ui';
import { CatalogUnavailable } from '../_catalog/CatalogListing';
import s from '../_catalog/catalog.module.css';
import c from './categories.module.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: `دسته‌بندی کالاها | ${getConfig().BRAND_NAME}` };
}

/** Every category with products, grouped under its parent (the header's «دسته‌بندی کالاها» link). */
export default async function CategoriesPage() {
  let all: Awaited<ReturnType<typeof catalogService.allCategories>>;
  try {
    all = await catalogService.allCategories();
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
      <div className={c.grid}>
        {roots.map((r) => {
          const children = all.filter((x) => x.parentCode === r.code);
          return (
            <section key={r.code} className={c.group} aria-labelledby={`cat-${r.code}`}>
              <h2 id={`cat-${r.code}`} className={c.groupTitle}>
                <Link href={r.href}>{r.name}</Link>
                <span className={c.count}>{formatNumber(r.count)}</span>
              </h2>
              {children.length > 0 && (
                <ul className={c.children}>
                  {children.map((ch) => (
                    <li key={ch.code}>
                      <Link href={ch.href} className={c.child}>
                        {ch.name}
                        <span className={c.count}>{formatNumber(ch.count)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Container>
  );
}
