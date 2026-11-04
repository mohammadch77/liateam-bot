import type { IconName } from '@/ui/icon/paths';

/** The admin panel's side menu: one list for the menu and for the numbers beside it. Pure (no data access). */
export type AdminCountKey = 'attention' | 'withdrawals' | 'commissions' | 'reviews' | 'affiliates';
export type AdminNavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** the number of things waiting, shown as a badge when above 0 */
  count?: AdminCountKey;
  exact?: boolean;
  /** shown to the support role too (view only) */
  support?: boolean;
};

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: '/admin', label: 'نیازمند توجه', icon: 'notifications', count: 'attention', exact: true },
  { href: '/admin/orders', label: 'سفارش‌ها', icon: 'shopping_bag', count: 'attention', support: true },
  { href: '/admin/withdrawals', label: 'برداشت‌ها', icon: 'account_balance_wallet', count: 'withdrawals' },
  { href: '/admin/commissions', label: 'پورسانت‌ها', icon: 'trending_up', count: 'commissions' },
  { href: '/admin/affiliates', label: 'همکاران و درخواست‌ها', icon: 'verified', count: 'affiliates' },
  { href: '/admin/reviews', label: 'دیدگاه‌ها', icon: 'star', count: 'reviews' },
  { href: '/admin/discounts', label: 'تخفیف‌ها', icon: 'bolt' },
  { href: '/admin/campaigns', label: 'کمپین‌ها', icon: 'spa' },
  { href: '/admin/packs', label: 'پک‌ها', icon: 'category' },
  { href: '/admin/bestsellers', label: 'پرفروش‌ترین‌ها', icon: 'brush' },
  { href: '/admin/settings', label: 'تنظیمات', icon: 'lock' },
];

export type AdminCounts = Record<AdminCountKey, number>;
export const NO_COUNTS: AdminCounts = { attention: 0, withdrawals: 0, commissions: 0, reviews: 0, affiliates: 0 };

/** The items a role sees: the admin all of them, support only what it may read. */
export const adminNavFor = (isAdmin: boolean): AdminNavItem[] => ADMIN_NAV.filter((i) => isAdmin || i.support);

/** Is this menu item the page we are on (the dashboard only on its own address, the others also on their sub-pages). */
export const adminNavActive = (item: AdminNavItem, path: string): boolean =>
  item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
