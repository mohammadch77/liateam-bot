import type { IconName } from '@/ui';

/**
 * Header/footer destinations that are not built yet (sales and account pages come with phase 2, static pages
 * with phase 3). Each has a real page that says so (HTTP 200, not indexed) instead of a 404. When a section is
 * built, its page replaces the placeholder and the entry is removed from here.
 */
export const COMING_SOON = {
  cart: { title: 'سبد خرید', icon: 'shopping_bag' },
  wallet: { title: 'کیف پول', icon: 'account_balance_wallet' },
  orders: { title: 'سفارش‌های من و پیگیری سفارش', icon: 'assignment_return' },
  favorites: { title: 'علاقه‌مندی‌ها', icon: 'favorite' },
  'help/order': { title: 'نحوه‌ی ثبت سفارش', icon: 'support_agent' },
  'help/shipping': { title: 'روش‌های ارسال و هزینه', icon: 'local_shipping' },
  'help/payment': { title: 'شیوه‌های پرداخت', icon: 'lock' },
  'legal/returns': { title: 'شرایط بازگشت کالا', icon: 'assignment_return' },
  'legal/privacy': { title: 'حریم خصوصی', icon: 'lock' },
  'legal/terms': { title: 'شرایط استفاده', icon: 'verified' },
  about: { title: 'درباره‌ی ما', icon: 'spa' },
  contact: { title: 'تماس با ما', icon: 'call' },
  newsletter: { title: 'عضویت در خبرنامه‌ی پیامکی', icon: 'notifications' },
} as const satisfies Record<string, { title: string; icon: IconName }>;

export type ComingSoonKey = keyof typeof COMING_SOON;

export const isComingSoonKey = (k: string): k is ComingSoonKey => Object.hasOwn(COMING_SOON, k);
