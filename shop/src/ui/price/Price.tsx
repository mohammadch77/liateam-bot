import { formatToman, formatTomanText, type Toman } from '@/lib/format/money';
import { cx } from '../cx';
import s from './Price.module.css';

type PriceProps = {
  /** current price in TOMAN (as stored) */
  toman: Toman;
  /** price before discount in TOMAN; shown struck-through only when higher than `toman` */
  oldToman?: Toman | null;
  /** lg: product page 24px · md: product card 16.5px · sm: search results / lists 13.5px */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

/** The only component that renders a price. Formatting lives in lib/format/money. */
export function Price({ toman, oldToman, size = 'md', className }: PriceProps) {
  const old = oldToman != null && oldToman > toman ? oldToman : null;
  const label =
    old !== null
      ? `قیمت ${formatTomanText(toman)}، قبل از تخفیف ${formatTomanText(old)}`
      : `قیمت ${formatTomanText(toman)}`;
  return (
    <span className={cx(s.price, s[size], className)}>
      <span className="sr-only">{label}</span>
      {old !== null && (
        <del className={s.old} aria-hidden="true">
          {formatToman(old)}
        </del>
      )}
      <span className={s.current} aria-hidden="true">
        <b className={s.amount}>{formatToman(toman)}</b>
        <span className={s.unit}>تومان</span>
      </span>
    </span>
  );
}

/** «سود شما: ۴۷٬۵۰۰ تومان» */
export function Saving({ toman, oldToman }: { toman: Toman; oldToman: Toman }) {
  if (oldToman <= toman) return null;
  return <span className={s.saving}>سود شما: {formatTomanText(oldToman - toman)}</span>;
}
