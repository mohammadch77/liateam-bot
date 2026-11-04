import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { packPath, packService } from '@/server/services/pack.service';
import { Breadcrumb, Container, Icon, ProductCard } from '@/ui';
import { CatalogUnavailable } from '@/app/(site)/_catalog/CatalogListing';
import { AddPackButton } from '@/app/(site)/_cart/AddPackButton';
import s from './pack.module.css';

type Props = { params: Promise<{ collection: string; variant: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { collection, variant } = await params;
  const data = await packService.pack(collection, variant).catch(() => null);
  if (!data) return { title: 'پک' };
  return {
    title: `${data.pack.title} | ${getConfig().BRAND_NAME}`,
    description:
      data.pack.description || `${data.pack.title}: ${data.pack.steps.map((x) => x.label).join('، ')}.`,
    alternates: { canonical: packPath(collection, variant) },
  };
}

/**
 * One pack: its steps in order (product, its current price, a link to it), the items' total struck through, the pack
 * price and the saving; the other variants of the collection as chips. «افزودن پک به سبد خرید» adds every available item.
 */
export default async function PackPage({ params }: Props) {
  const { collection, variant } = await params;
  let data: Awaited<ReturnType<typeof packService.pack>>;
  try {
    data = await packService.pack(collection, variant);
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }
  if (!data) notFound();
  const { collection: c, pack: p } = data;

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: c.title }, { label: p.variantTitle }]} />
      <header className={s.head}>
        <h1 className={s.title}>{p.title}</h1>
        {p.description && <p className={s.lead}>{p.description}</p>}
        <nav className={s.chips} aria-label={c.variantLabel}>
          {c.packs.map((x) => (
            <Link
              key={x.key}
              href={x.href}
              className={s.chip}
              aria-current={x.key === p.key ? 'page' : undefined}
            >
              {x.variantTitle}
            </Link>
          ))}
        </nav>
      </header>

      <div className={s.layout}>
        <ol className={s.steps} data-pack-cards>
          {p.steps.map((st, i) => (
            <li key={i} className={s.step} data-status={st.status}>
              <span className={s.stepTag}>
                <b aria-hidden="true">{toFaDigits(i + 1)}</b>
                {st.label}
              </span>
              {st.product ? (
                <ProductCard product={st.product} />
              ) : (
                <div className={s.soonCard}>
                  <Icon name="spa" size={36} />
                  <b>به‌زودی</b>
                </div>
              )}
            </li>
          ))}
        </ol>

        <aside className={s.summary} aria-label="قیمت پک">
          {p.available && p.final !== null ? (
            <>
              <span className={s.sumLabel}>جمع قیمت محصولات</span>
              {p.final < p.total ? (
                <del className="tnum">{formatToman(p.total)} تومان</del>
              ) : (
                <span className="tnum">{formatToman(p.total)} تومان</span>
              )}
              <span className={s.sumLabel}>قیمت پک</span>
              <b className={`${s.final} tnum`}>
                {formatToman(p.final)} <span>تومان</span>
              </b>
              {p.saving > 0 && <span className={s.saving}>{toFaDigits(p.saving)}٪ صرفه‌جویی</span>}
            </>
          ) : (
            <b className={s.unavailable}>این پک فعلاً در دسترس نیست</b>
          )}
          <AddPackButton
            collection={collection}
            variant={variant}
            className={s.addPack}
            disabled={!p.available}
            dataAttr="data-pack-add"
          />
        </aside>
      </div>
    </Container>
  );
}
