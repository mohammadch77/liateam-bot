import Link from 'next/link';
import type { ReactNode } from 'react';
import { discountPercent, type Rial } from '@/lib/format/money';
import { formatDecimal, formatNumber } from '@/lib/format/number';
import { Badge, DiscountRibbon } from '../badge/Badge';
import { Icon } from '../icon/Icon';
import { Price } from '../price/Price';
import { Skeleton } from '../skeleton/Skeleton';
import { Spinner } from '../spinner/Spinner';
import { cx } from '../cx';
import s from './ProductCard.module.css';

export type StockState = 'in' | 'limited' | 'out';

/** Display data only — the catalog service (tick 5) maps database rows to this shape. */
export type ProductCardData = {
  href: string;
  name: string;
  brand?: string | null;
  imageUrl?: string | null;
  priceRial: Rial;
  oldPriceRial?: Rial | null;
  stock: StockState;
  rating?: number | null;
  reviews?: number | null;
};

type ProductCardProps = {
  product: ProductCardData;
  /** add-to-cart control; defaults to the idle «افزودن به سبد» button (wired up by a client component later) */
  action?: ReactNode;
  /** favourite control; defaults to the empty-heart button */
  favorite?: ReactNode;
  /** first rows of a page: load the image eagerly */
  priority?: boolean;
};

export function ProductCard({ product: p, action, favorite, priority }: ProductCardProps) {
  const out = p.stock === 'out';
  const off = out ? 0 : discountPercent(p.priceRial, p.oldPriceRial);
  return (
    <article className={cx(s.card, out && s.out)}>
      <div className={s.stage}>
        <span className={s.pedestal} aria-hidden="true" />
        {p.imageUrl ? (
          // Supplier images come from their CDN at their own sizes; next/image optimisation is set up with the
          // catalog (tick 5) once the image host is fixed.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imageUrl}
            alt=""
            className={s.image}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : (
          <span className={s.noImage} aria-hidden="true">
            <Icon name="spa" size={56} />
          </span>
        )}
        {off > 0 && <DiscountRibbon percent={off} className={s.ribbon} />}
        <span className={s.fav}>{favorite ?? <FavoriteButton />}</span>
        {(p.stock === 'limited' || out) && (
          <span className={s.badges}>
            <Badge tone={out ? 'outOfStock' : 'limited'} size="sm" />
          </span>
        )}
      </div>

      <div className={s.body}>
        <div className={s.meta}>
          <span className={s.brand}>{p.brand}</span>
          {p.rating != null && (
            <span className={s.rating}>
              <Icon name="star" filled size={15} className={s.star} />
              {formatDecimal(p.rating)}
              {p.reviews != null && <span className={s.reviews}>({formatNumber(p.reviews)})</span>}
            </span>
          )}
        </div>
        <h3 className={s.name}>
          <Link href={p.href} className={s.link}>
            {p.name}
          </Link>
        </h3>
        <div className={s.footer}>
          {out ? (
            <>
              <span className={s.outLabel}>ناموجود</span>
              <span className={s.action}>
                <button type="button" className={s.notify}>
                  <Icon name="notifications" size={18} />
                  خبرم کن
                </button>
              </span>
            </>
          ) : (
            <>
              <Price rial={p.priceRial} oldRial={p.oldPriceRial} size="md" />
              <span className={s.action}>{action ?? <AddToCartButton state="idle" />}</span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** Visual add-to-cart button in its three design states. */
export function AddToCartButton({ state }: { state: 'idle' | 'loading' | 'done' }) {
  const cls = state === 'loading' ? s.addLoading : state === 'done' ? s.addDone : s.addIdle;
  const label =
    state === 'loading' ? 'در حال افزودن' : state === 'done' ? 'به سبد افزوده شد' : 'افزودن به سبد خرید';
  return (
    <button
      type="button"
      className={cx(s.iconButton, cls)}
      aria-label={label}
      aria-busy={state === 'loading'}
    >
      {state === 'loading' ? (
        <Spinner />
      ) : (
        <Icon name={state === 'done' ? 'check' : 'add_shopping_cart'} size={21} />
      )}
    </button>
  );
}

export function FavoriteButton({ on = false }: { on?: boolean }) {
  return (
    <button
      type="button"
      className={cx(s.iconButton, s.favButton, on && s.favOn)}
      aria-pressed={on}
      aria-label={on ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
    >
      <Icon name="favorite" filled={on} size={21} />
    </button>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className={cx(s.card, s.skeleton)} aria-busy="true" aria-label="در حال بارگذاری">
      <div className={s.stage} />
      <div className={s.skeletonBody}>
        <Skeleton width="36%" height={10} />
        <Skeleton width="92%" height={12} />
        <Skeleton width="64%" height={12} />
        <div className={s.skeletonRow}>
          <Skeleton width="48%" height={18} />
          <Skeleton width={40} height={40} radius={12} />
        </div>
      </div>
    </div>
  );
}
