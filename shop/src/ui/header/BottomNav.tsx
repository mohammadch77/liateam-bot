import Link from 'next/link';
import { formatNumber } from '@/lib/format/number';
import { Icon, type IconName } from '../icon/Icon';
import s from './BottomNav.module.css';

export type BottomNavItem = {
  icon: IconName;
  label: string;
  href: string;
  current?: boolean;
  count?: number;
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
          aria-label={t.count ? `${t.label}، ${formatNumber(t.count)} کالا` : undefined}
        >
          <Icon name={t.icon} size={25} filled={t.current} />
          {t.label}
          {!!t.count && (
            <span className={s.count} aria-hidden="true">
              {formatNumber(t.count)}
            </span>
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
