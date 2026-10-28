import 'server-only';
import { getConfig } from '@/lib/config';
import type { CurrentUser } from '@/server/services/session.service';
import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { catalogService } from '@/server/services/catalog.service';
import { pricingService } from '@/server/services/pricing.service';
import type { BottomNavItem, FooterProps, HeaderProps, NavItem } from '@/ui';
import {
  aboutPath,
  brandsPath,
  cartPath,
  contactPath,
  categoriesPath,
  offersPath,
  ordersPath,
  searchPath,
  shopPath,
} from '@/lib/urls';

/**
 * Header / footer / tab-bar data for every storefront page. Brand and contact details come from config (the
 * brand name is not final). The free-shipping line comes from the order settings (shipping.free_enabled / _from_toman).
 */

const LINKS = {
  cart: cartPath(),
  account: '/account',
  wallet: '/account/wallet',
  login: '/login',
  orders: ordersPath(),
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
      code: x.code,
      count: x.count,
      imageUrl: x.imageUrl,
      children: x.children.map((ch) => ({ label: ch.name, href: ch.href, count: ch.count, code: ch.code })),
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
      code: b.code,
      count: b.count,
      imageUrl: b.logoUrl,
    }));
  } catch (e) {
    logger.warn('site.header_brands_unavailable', { code: toAppError(e).code });
    return [];
  }
}

/**
 * Plain links of the menu bar after «فروشگاه» and «برندها» (SiteHeader.dc.html order); the same list in the phone
 * drawer. About / contact / FAQ are placeholders until phase 3.
 */
const PAGES = [
  { label: 'تخفیفات ویژه', href: offersPath() },
  { label: 'همکاری در فروش', href: '/affiliate' },
  { label: 'درباره ما', href: aboutPath() },
  { label: 'تماس با ما', href: contactPath() },
  { label: 'سوالات متداول', href: '/help/faq' },
];

/** The running campaign of the bar above the header (none if the pricing is unavailable). */
export async function headerCampaign(): Promise<{ text: string; href: string } | null> {
  const c = await pricingService.campaign();
  return c ? { text: c.banner_text, href: c.link } : null;
}

export function headerProps(
  user: CurrentUser | null,
  categories: NavItem[] = [],
  brands: NavItem[] = [],
  campaign: { text: string; href: string } | null = null,
  /** «ارسال رایگان از مبلغ X»: the threshold from the settings, null while the switch is off (then nothing is promised) */
  freeShippingFromToman: number | null = null,
  cartCount = 0,
): HeaderProps {
  const c = getConfig();
  return {
    brand: { name: c.BRAND_NAME, latin: c.BRAND_LATIN },
    categories,
    allCategoriesHref: categoriesPath(),
    shopHref: shopPath(),
    brands,
    brandsHref: brandsPath(),
    pages: PAGES,
    cartCount,
    signedIn: user !== null,
    walletToman: null, // wallet arrives in phase 2
    freeShippingFromToman,
    campaign,
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
          { label: 'درباره ما', href: aboutPath() },
          { label: 'تماس با ما', href: contactPath() },
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

export function bottomNavItems(user: CurrentUser | null, cartCount = 0): BottomNavItem[] {
  return [
    { icon: 'home', label: 'خانه', href: '/' },
    { icon: 'grid_view', label: 'دسته‌ها', href: categoriesPath() },
    { icon: 'search', label: 'جست‌وجو', href: searchPath(), openSearch: true },
    { icon: 'shopping_bag', label: 'سبد', href: LINKS.cart, cart: true, count: cartCount },
    { icon: 'person', label: user ? 'حساب' : 'ورود', href: user ? LINKS.account : LINKS.login },
  ];
}
