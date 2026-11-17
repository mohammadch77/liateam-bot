'use client';

import { PanelNav, type PanelNavItem } from './PanelNav';

const ITEMS: readonly PanelNavItem[] = [
  { href: '/account', label: 'داشبورد', icon: 'home', exact: true },
  { href: '/account/orders', label: 'سفارش‌ها', icon: 'shopping_bag' },
  { href: '/account/addresses', label: 'آدرس‌ها', icon: 'location_on' },
  { href: '/account/wallet', label: 'کیف پول', icon: 'account_balance_wallet' },
  { href: '/account/favorites', label: 'علاقه‌مندی‌ها', icon: 'favorite' },
  { href: '/account/affiliate', label: 'همکاری در فروش', icon: 'verified' },
  { href: '/account/profile', label: 'پروفایل', icon: 'person' },
];

/** Side menu on desktop, a mobile hamburger bar + drawer on phones. */
export function AccountNav() {
  return (
    <PanelNav
      title="حساب کاربری"
      items={ITEMS}
      dataAttr="data-account-nav"
      backToSiteHref="/"
      backToSiteLabel="بازگشت به فروشگاه"
    />
  );
}
