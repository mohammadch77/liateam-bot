import 'server-only';
import { getConfig } from '@/lib/config';
import type { CurrentUser } from '@/server/services/session.service';
import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { catalogService } from '@/server/services/catalog.service';
import type { BottomNavItem, FooterProps, HeaderProps, NavItem } from '@/ui';

/**
 * Header / footer / tab-bar data for every storefront page. Brand and contact details come from config (the
 * brand name is not final). Shop settings such as the free-shipping threshold move to the admin panel in phase 3.
 */
const FREE_SHIPPING_FROM_TOMAN = 999_000;

const LINKS = {
  cart: '/cart',
  account: '/account',
  wallet: '/account/wallet',
  login: '/login',
  orders: '/account/orders',
  favorites: '/account/favorites',
} as const;

/**
 * The header's categories in Liateam's order: top-level ones (the bar shows as many as fit, never a cut-off one)
 * with their sub-categories for the mega menu and the mobile drawer. Categories with nothing to sell are already
 * left out by the repository. The header still renders (without them) if the catalog is down.
 */
export async function headerCategories(): Promise<NavItem[]> {
  try {
    const menu = await catalogService.menu();
    return menu.map((x) => ({
      label: x.name,
      href: x.href,
      count: x.count,
      imageUrl: x.imageUrl,
      children: x.children.map((ch) => ({ label: ch.name, href: ch.href, count: ch.count })),
    }));
  } catch (e) {
    logger.warn('site.header_categories_unavailable', { code: toAppError(e).code });
    return [];
  }
}

/** The header's «برندها» menu: brands with products, logo as the picture. Empty (link only) if the catalog is down. */
export async function headerBrands(): Promise<NavItem[]> {
  try {
    return (await catalogService.brands()).map((b) => ({
      label: b.name,
      href: b.href,
      count: b.count,
      imageUrl: b.logoUrl,
    }));
  } catch (e) {
    logger.warn('site.header_brands_unavailable', { code: toAppError(e).code });
    return [];
  }
}

/** Plain links of the menu bar, after «فروشگاه» and «برندها» (as on Liateam; placeholders until phase 3). */
const PAGES = [
  { label: 'درباره ما', href: '/about' },
  { label: 'تماس با ما', href: '/contact' },
  { label: 'سوالات متداول', href: '/help/faq' },
];

export function headerProps(
  user: CurrentUser | null,
  categories: NavItem[] = [],
  brands: NavItem[] = [],
): HeaderProps {
  const c = getConfig();
  return {
    brand: { name: c.BRAND_NAME, latin: c.BRAND_LATIN },
    categories,
    allCategoriesHref: '/categories',
    shopHref: '/shop',
    brands,
    brandsHref: '/brands',
    pages: PAGES,
    cartCount: 0,
    signedIn: user !== null,
    walletToman: null, // wallet arrives in phase 2
    freeShippingFromToman: FREE_SHIPPING_FROM_TOMAN,
    supportPhone: c.SUPPORT_PHONE,
    links: LINKS,
  };
}

export function footerProps(): Omit<FooterProps, 'seals'> {
  const c = getConfig();
  return {
    brandName: c.BRAND_NAME,
    about:
      'فروشگاه تخصصی محصولات آرایشی، بهداشتی و مراقبت شخصی؛ تمام کالاها مستقیم از تأمین‌کننده رسمی و با ضمانت اصالت ارسال می‌شوند.',
    trust: [
      { icon: 'verified', title: 'ضمانت اصالت کالا', sub: 'مستقیم از تأمین‌کننده رسمی' },
      { icon: 'assignment_return', title: '۷ روز ضمانت بازگشت', sub: 'برای کالای باز نشده' },
      { icon: 'lock', title: 'پرداخت امن', sub: 'درگاه شاپرک و کیف پول' },
      { icon: 'local_shipping', title: 'ارسال به سراسر ایران', sub: 'سریع و مطمئن' },
      { icon: 'support_agent', title: 'پشتیبانی انسانی', sub: 'گفت‌وگوی زنده' },
    ],
    columns: [
      {
        title: 'راهنمای خرید',
        links: [
          { label: 'نحوه ثبت سفارش', href: '/help/order' },
          { label: 'روش‌های ارسال و هزینه', href: '/help/shipping' },
          { label: 'شیوه‌های پرداخت', href: '/help/payment' },
          { label: 'پیگیری سفارش', href: LINKS.orders },
        ],
      },
      {
        title: 'قوانین و مقررات',
        links: [
          { label: 'شرایط بازگشت کالا', href: '/legal/returns' },
          { label: 'حریم خصوصی', href: '/legal/privacy' },
          { label: 'شرایط استفاده', href: '/legal/terms' },
        ],
      },
      {
        title: c.BRAND_NAME,
        links: [
          { label: 'درباره ما', href: '/about' },
          { label: 'تماس با ما', href: '/contact' },
          { label: 'همکاری در فروش', href: '/affiliate?from=footer' },
        ],
      },
    ],
    contact: { phone: c.SUPPORT_PHONE, hours: 'هر روز ۹ تا ۲۱', email: '', address: '' },
    newsletterAction: '/api/newsletter',
    social: [],
    copyright: `© ${new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric' }).format(new Date())} — تمامی حقوق برای فروشگاه اینترنتی ${c.BRAND_NAME} محفوظ است.`,
  };
}

export function bottomNavItems(user: CurrentUser | null): BottomNavItem[] {
  return [
    { icon: 'home', label: 'خانه', href: '/' },
    { icon: 'grid_view', label: 'دسته‌ها', href: '/categories' },
    { icon: 'search', label: 'جست‌وجو', href: '/search' },
    { icon: 'shopping_bag', label: 'سبد', href: LINKS.cart },
    { icon: 'person', label: user ? 'حساب' : 'ورود', href: user ? LINKS.account : LINKS.login },
  ];
}
