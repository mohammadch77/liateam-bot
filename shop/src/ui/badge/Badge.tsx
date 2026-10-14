import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatPercent } from '@/lib/format/money';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '../cx';
import s from './Badge.module.css';

export type BadgeTone = 'limited' | 'outOfStock' | 'inStock' | 'genuine' | 'new' | 'neutral' | 'soon';

/** Default label and icon per tone, exactly as in the style sheet. */
const PRESETS: Record<BadgeTone, { label: string; icon?: IconName }> = {
  limited: { label: 'موجودی محدود' },
  outOfStock: { label: 'ناموجود' },
  inStock: { label: 'موجود', icon: 'inventory_2' },
  genuine: { label: 'اصل', icon: 'verified' },
  new: { label: 'جدید' },
  neutral: { label: '' },
  soon: { label: 'به‌زودی' },
};

type BadgeProps = {
  tone: BadgeTone;
  children?: ReactNode;
  icon?: IconName;
  size?: 'sm' | 'md';
};

export function Badge({ tone, children, icon, size = 'md' }: BadgeProps) {
  const preset = PRESETS[tone];
  const glyph = icon ?? preset.icon;
  return (
    <span className={cx(s.badge, s[tone], size === 'sm' && s.small)}>
      {tone === 'limited' && <span className={s.dot} aria-hidden="true" />}
      {glyph && <Icon name={glyph} size={15} />}
      {children ?? preset.label}
    </span>
  );
}

/** «۱۵٪» tag. */
export function DiscountTag({ percent }: { percent: number }) {
  return <span className={cx(s.badge, s.discount)}>{formatPercent(percent)}</span>;
}

/** Berry ribbon «۲۰٪ تخفیف» that hangs from the top of a product image. */
export function DiscountRibbon({ percent, className }: { percent: number; className?: string }) {
  return (
    <span className={cx(s.ribbon, className)}>
      <span className={s.ribbonValue}>{formatPercent(percent)}</span>
      <span className={s.ribbonLabel}>تخفیف</span>
    </span>
  );
}

/** Active filter chip; removing is a link (works without JavaScript) to the URL without this filter. */
export function FilterChip({ children, removeHref }: { children: ReactNode; removeHref: string }) {
  return (
    <span className={s.chip}>
      {children}
      <Link href={removeHref} className={s.chipRemove} aria-label={`حذف فیلتر ${String(children)}`}>
        <Icon name="close" size={16} />
      </Link>
    </span>
  );
}
