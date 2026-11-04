'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/ui';
import s from '../account.module.css';

const ITEMS: Array<{ href: string; label: string; icon: IconName; exact?: boolean }> = [
  { href: '/account', label: 'داشبورد', icon: 'home', exact: true },
  { href: '/account/orders', label: 'سفارش‌ها', icon: 'shopping_bag' },
  { href: '/account/addresses', label: 'آدرس‌ها', icon: 'location_on' },
  { href: '/account/wallet', label: 'کیف پول', icon: 'account_balance_wallet' },
  { href: '/account/favorites', label: 'علاقه‌مندی‌ها', icon: 'favorite' },
  { href: '/account/affiliate', label: 'همکاری در فروش', icon: 'verified' },
  { href: '/account/profile', label: 'پروفایل', icon: 'person' },
];

/** Side menu on desktop, a scrolling row of tabs on mobile (CSS decides); the current page is marked with aria-current. */
export function AccountNav() {
  const path = usePathname();
  return (
    <nav className={s.nav} aria-label="منوی حساب کاربری" data-account-nav>
      {ITEMS.map((i) => {
        const on = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} className={s.navLink} aria-current={on ? 'page' : undefined}>
            <Icon name={i.icon} size={20} />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
