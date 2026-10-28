import Link from 'next/link';
import { formatNumber } from '@/lib/format/number';
import { Icon, type IconName } from '../icon/Icon';
import { BottomNavCount } from './BottomNavCount';
import s from './BottomNav.module.css';

export type BottomNavItem = {
  icon: IconName;
  label: string;
  href: string;
  current?: boolean;
  count?: number;
  /** opens the full-screen search (SearchOverlay) instead of following the link, when JavaScript runs */
  openSearch?: boolean;
  /** the cart tab: its number follows the cart of the page */
  cart?: boolean;
};

/** Mobile tab bar «ناوبری اصلی» (Homepage mobile frame); hidden from 1024px where the header has everything. */
export function BottomNav({ items }: { items: readonly BottomNavItem[] }) {
  return (
    <nav aria-label="ناوبری اصلی" className={s.bar}>
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={s.item}
          aria-current={t.current ? 'page' : undefined}
          aria-label={!t.cart && t.count ? `${t.label}، ${formatNumber(t.count)} کالا` : undefined}
          data-open-search={t.openSearch ? '' : undefined}
        >
          <Icon name={t.icon} size={25} filled={t.current} />
          {t.label}
          {t.cart ? (
            <BottomNavCount initial={t.count ?? 0} />
          ) : (
            !!t.count && (
              <span className={s.count} aria-hidden="true">
                {formatNumber(t.count)}
              </span>
            )
          )}
        </Link>
      ))}
    </nav>
  );
}

/** Space at the end of the page so the fixed tab bar never covers content (mobile only). */
export function BottomNavSpacer() {
  return <div className={s.spacer} aria-hidden="true" />;
}
