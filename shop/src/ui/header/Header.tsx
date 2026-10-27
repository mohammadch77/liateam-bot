import Link from 'next/link';
import { formatToman, formatTomanShort, type Toman } from '@/lib/format/money';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { Icon } from '../icon/Icon';
import { Container } from '../layout/Layout';
import { BrandMenu, MegaMenu } from './MegaMenu';
import { MobileMenu } from './MobileMenu';
import { SearchBox } from './SearchBox';
import { SearchOverlay } from './SearchOverlay';
import s from './Header.module.css';

export type Brand = { name: string; latin: string; homeHref?: string };
export type NavItem = {
  label: string;
  href: string;
  /** Liateam's category / brand code: the menus load its products on hover (/api/nav/products) */
  code?: number;
  current?: boolean;
  /** visible products (shown in the menus) */
  count?: number;
  /** cover picture of a top-level category in the mega menu */
  imageUrl?: string | null;
  /** sub-categories, in Liateam's order (mega menu, mobile drawer) */
  children?: readonly NavItem[];
};

export type HeaderProps = {
  brand: Brand;
  /** top-level categories with their sub-categories: the bar under the search row, the mega menu, the drawer */
  categories: readonly NavItem[];
  allCategoriesHref: string;
  /** «فروشگاه»: all products (its menu is the category tree) */
  shopHref: string;
  /** «برندها»: brands with products, in Liateam's order (imageUrl = the logo) */
  brands: readonly NavItem[];
  brandsHref: string;
  /** plain bar links after the menus (about, contact, FAQ) */
  pages: readonly { label: string; href: string }[];
  searchAction?: string;
  searchQuery?: string;
  cartCount: number;
  /** signed out shows «ورود | ثبت‌نام»; signed in shows the account link (and the wallet when known) */
  signedIn: boolean;
  /** wallet balance of a signed-in user; null until the wallet exists */
  walletToman: Toman | null;
  /** «ارسال رایگان از مبلغ X»; null = the shop does not promise free shipping (the line is not shown) */
  freeShippingFromToman: Toman | null;
  /** a running campaign: a bar above the header (text from the admin panel, a same-site link) */
  campaign?: { text: string; href: string } | null;
  supportPhone: string;
  deliverTo?: string;
  links: { cart: string; account: string; wallet: string; login: string; orders: string; favorites: string };
};

/**
 * SiteHeader: top bar, logo + search + wallet/account/cart, then the menu bar like Liateam's: «فروشگاه» (all
 * products; hover → the category tree), «برندها» (brands page; hover → the brands), about / contact / FAQ
 * (desktop); compact header with the same items in the drawer (mobile).
 */
export function Header(p: HeaderProps) {
  const home = p.brand.homeHref ?? '/';
  const wallet = p.walletToman;
  return (
    <header className={s.header}>
      {p.campaign && (
        <Link href={p.campaign.href} className={s.campaignBar} data-campaign-bar>
          <Icon name="bolt" size={17} />
          <span className={s.campaignText}>{p.campaign.text}</span>
          <Icon name="arrow_back" size={16} />
        </Link>
      )}
      <div className={s.desktop}>
        <div className={s.topbar}>
          <Container className={s.topbarInner}>
            <div className={s.topbarGroup}>
              {p.freeShippingFromToman !== null && (
                <span className={s.topbarItem}>
                  <Icon name="local_shipping" size={17} className={s.topbarIcon} />
                  ارسال رایگان برای خریدهای بالای{' '}
                  <b className={s.topbarStrong}>{formatToman(p.freeShippingFromToman)} تومان</b>
                </span>
              )}
              <span className={`${s.topbarItem} ${s.hideNarrow}`}>
                <Icon name="verified" size={17} className={s.topbarIcon} />
                ضمانت اصالت تمام کالاها
              </span>
            </div>
            <div className={s.topbarGroup}>
              <Link href={p.links.orders} className={s.topbarItem}>
                پیگیری سفارش
              </Link>
              {p.supportPhone && (
                <>
                  <span className={s.topbarRule} aria-hidden="true" />
                  <a href={`tel:${p.supportPhone.replace(/[^\d+]/g, '')}`} className={s.topbarItem}>
                    <Icon name="call" size={17} className={s.topbarIcon} />
                    پشتیبانی:{' '}
                    <span dir="ltr" className="tnum">
                      {toFaDigits(p.supportPhone)}
                    </span>
                  </a>
                </>
              )}
            </div>
          </Container>
        </div>

        <Container className={s.main}>
          <Logo brand={p.brand} href={home} />
          <SearchBox action={p.searchAction} query={p.searchQuery} />
          <div className={s.actions}>
            {p.signedIn ? (
              <>
                <Link href={p.links.wallet} className={s.wallet} data-header-action="wallet">
                  <Icon name="account_balance_wallet" size={20} className={s.walletIcon} />
                  <span className={s.walletText}>
                    <span className={s.walletLabel}>کیف پول</span>
                    {wallet !== null && (
                      <span className={s.walletAmount}>
                        {formatToman(wallet)} <span className={s.walletUnit}>تومان</span>
                      </span>
                    )}
                  </span>
                </Link>
                <Link
                  href={p.links.account}
                  className={s.iconLink}
                  aria-label="حساب کاربری"
                  data-header-action="account"
                >
                  <Icon name="person" size={24} />
                </Link>
              </>
            ) : (
              <Link href={p.links.login} className={s.login} data-header-action="account">
                <Icon name="person" size={20} />
                ورود | ثبت‌نام
              </Link>
            )}
            <CartLink href={p.links.cart} count={p.cartCount} />
          </div>
        </Container>

        <nav aria-label="منوی اصلی" className={s.nav}>
          <Container className={s.navInner}>
            <MegaMenu items={p.categories} href={p.shopHref} allHref={p.allCategoriesHref} />
            <BrandMenu items={p.brands} href={p.brandsHref} />
            <span className={s.navRule} aria-hidden="true" />
            <ul className={s.navList}>
              {p.pages.map((x) => (
                <li key={x.href}>
                  <Link href={x.href} className={s.navLink}>
                    {x.label}
                  </Link>
                </li>
              ))}
            </ul>
            <span className={s.navSpacer} />
            {p.deliverTo && (
              <span className={s.deliver}>
                <Icon name="location_on" size={18} className={s.walletIcon} />
                ارسال به: <b>{p.deliverTo}</b>
              </span>
            )}
          </Container>
        </nav>
      </div>

      <div className={s.mobile}>
        {p.freeShippingFromToman !== null && (
          <div className={s.promo}>
            <Icon name="local_shipping" size={16} />
            ارسال رایگان خریدهای بالای {formatToman(p.freeShippingFromToman)} تومان
          </div>
        )}
        <div className={s.mobileRow}>
          <div className={s.mobileGroup}>
            <MobileMenu
              items={p.categories}
              allHref={p.allCategoriesHref}
              shopHref={p.shopHref}
              brands={p.brands}
              brandsHref={p.brandsHref}
              pages={p.pages}
              brandName={p.brand.name}
              signedIn={p.signedIn}
              links={p.links}
              supportPhone={p.supportPhone}
            />
            <Link href={home} className={s.mobileLogo} aria-label={`${p.brand.name} — صفحه اصلی`}>
              {p.brand.name}
              <span className={s.logoDot}>.</span>
            </Link>
          </div>
          <div className={s.mobileGroup}>
            {p.signedIn ? (
              <>
                {wallet !== null ? (
                  <Link href={p.links.wallet} className={s.walletShort} data-header-action="wallet">
                    <Icon name="account_balance_wallet" size={18} className={s.walletIcon} />
                    {formatTomanShort(wallet)}
                  </Link>
                ) : (
                  <Link
                    href={p.links.wallet}
                    className={s.iconLink}
                    aria-label="کیف پول"
                    data-header-action="wallet"
                  >
                    <Icon name="account_balance_wallet" size={24} />
                  </Link>
                )}
                <Link
                  href={p.links.account}
                  className={s.iconLink}
                  aria-label="حساب کاربری"
                  data-header-action="account"
                >
                  <Icon name="person" size={24} />
                </Link>
              </>
            ) : (
              <Link href={p.links.login} className={s.walletShort} data-header-action="account">
                <Icon name="person" size={18} />
                ورود
              </Link>
            )}
            <Link
              href={p.links.favorites}
              className={s.iconLink}
              aria-label="علاقه‌مندی‌ها"
              data-header-action="favorites"
            >
              <Icon name="favorite" size={24} />
            </Link>
          </div>
        </div>
        <div className={s.mobileSearchWrap}>
          <SearchBox action={p.searchAction} query={p.searchQuery} compact />
        </div>
        <SearchOverlay action={p.searchAction} query={p.searchQuery} />
      </div>
    </header>
  );
}

function Logo({ brand, href }: { brand: Brand; href: string }) {
  return (
    <Link href={href} className={s.logo} aria-label={`${brand.name} — صفحه اصلی`}>
      <span className={s.logoName}>
        {brand.name}
        <span className={s.logoDot}>.</span>
      </span>
      <span className={s.logoLatin}>{brand.latin}</span>
    </Link>
  );
}

function CartLink({ href, count }: { href: string; count: number }) {
  return (
    <Link
      href={href}
      className={s.iconLink}
      aria-label={count > 0 ? `سبد خرید، ${formatNumber(count)} کالا` : 'سبد خرید'}
      data-header-action="cart"
    >
      <Icon name="shopping_bag" size={24} />
      {count > 0 && (
        <span className={s.count} aria-hidden="true">
          {formatNumber(count)}
        </span>
      )}
    </Link>
  );
}
