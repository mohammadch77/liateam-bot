import { formatToman, formatTomanText, type Rial } from '@/lib/format/money';
import { cx } from '../cx';
import s from './Price.module.css';

type PriceProps = {
  /** current price in RIAL (as stored); shown in toman */
  rial: Rial;
  /** price before discount in RIAL; shown struck-through only when higher than `rial` */
  oldRial?: Rial | null;
  /** lg: product page 24px · md: product card 16.5px · sm: search results / lists 13.5px */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

/** The only component that renders a price. Conversion and formatting live in lib/format/money. */
export function Price({ rial, oldRial, size = 'md', className }: PriceProps) {
  const old = oldRial != null && oldRial > rial ? oldRial : null;
  const label =
    old !== null
      ? `قیمت ${formatTomanText(rial)}، قبل از تخفیف ${formatTomanText(old)}`
      : `قیمت ${formatTomanText(rial)}`;
  return (
    <span className={cx(s.price, s[size], className)}>
      <span className="sr-only">{label}</span>
      {old !== null && (
        <del className={s.old} aria-hidden="true">
          {formatToman(old)}
        </del>
      )}
      <span className={s.current} aria-hidden="true">
        <b className={s.amount}>{formatToman(rial)}</b>
        <span className={s.unit}>تومان</span>
      </span>
    </span>
  );
}

/** «سود شما: ۴۷٬۵۰۰ تومان» */
export function Saving({ rial, oldRial }: { rial: Rial; oldRial: Rial }) {
  if (oldRial <= rial) return null;
  return <span className={s.saving}>سود شما: {formatTomanText(oldRial - rial)}</span>;
}
