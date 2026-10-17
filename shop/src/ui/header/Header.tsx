import Link from 'next/link';
import { formatToman, formatTomanShort, type Toman } from '@/lib/format/money';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { Icon } from '../icon/Icon';
import { Container } from '../layout/Layout';
import s from './Header.module.css';

export type Brand = { name: string; latin: string; homeHref?: string };
export type NavItem = { label: string; href: string; highlight?: boolean; current?: boolean };

export type HeaderProps = {
  brand: Brand;
  /** category links in the bar under the search row */
  categories: readonly NavItem[];
  allCategoriesHref: string;
  searchAction?: string;
  searchQuery?: string;
  cartCount: number;
  /** signed out shows «ورود | ثبت‌نام»; signed in shows the account link (and the wallet when known) */
  signedIn: boolean;
  /** wallet balance of a signed-in user; null until the wallet exists */
  walletToman: Toman | null;
  freeShippingFromToman: Toman;
  supportPhone: string;
  deliverTo?: string;
  links: { cart: string; account: string; wallet: string; login: string; orders: string; favorites: string };
};

/** SiteHeader: top bar, logo + search + wallet/account/cart, category bar (desktop); compact header (mobile). */
export function Header(p: HeaderProps) {
  const home = p.brand.homeHref ?? '/';
  const wallet = p.walletToman;
  return (
    <header className={s.header}>
      <div className={s.desktop}>
        <div className={s.topbar}>
          <Container className={s.topbarInner}>
            <div className={s.topbarGroup}>
              <span className={s.topbarItem}>
                <Icon name="local_shipping" size={17} className={s.topbarIcon} />
                ارسال رایگان برای خریدهای بالای{' '}
                <b className={s.topbarStrong}>{formatToman(p.freeShippingFromToman)} تومان</b>
              </span>
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
                {wallet !== null && (
                  <Link href={p.links.wallet} className={s.wallet}>
                    <Icon name="account_balance_wallet" size={20} className={s.walletIcon} />
                    <span className={s.walletText}>
                      <span className={s.walletLabel}>کیف پول</span>
                      <span className={s.walletAmount}>
                        {formatToman(wallet)} <span className={s.walletUnit}>تومان</span>
                      </span>
                    </span>
                  </Link>
                )}
                <Link href={p.links.account} className={s.iconLink} aria-label="حساب کاربری">
                  <Icon name="person" size={24} />
                </Link>
              </>
            ) : (
              <Link href={p.links.login} className={s.login}>
                <Icon name="person" size={20} />
                ورود | ثبت‌نام
              </Link>
            )}
            <CartLink href={p.links.cart} count={p.cartCount} />
          </div>
        </Container>

        <nav aria-label="دسته‌بندی‌ها" className={s.nav}>
          <Container className={s.navInner}>
            <Link href={p.allCategoriesHref} className={s.allCats}>
              <Icon name="menu" size={22} />
              دسته‌بندی کالاها
            </Link>
            <span className={s.navRule} aria-hidden="true" />
            <ul className={s.navList}>
              {p.categories.map((c) => (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    className={`${s.navLink} ${c.highlight ? s.navHighlight : ''}`}
                    aria-current={c.current ? 'page' : undefined}
                  >
                    {c.highlight && <Icon name="bolt" size={19} />}
                    {c.label}
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
        <div className={s.promo}>
          <Icon name="local_shipping" size={16} />
          ارسال رایگان خریدهای بالای {formatToman(p.freeShippingFromToman)} تومان
        </div>
        <div className={s.mobileRow}>
          <div className={s.mobileGroup}>
            <Link href={p.allCategoriesHref} className={s.iconLink} aria-label="منو">
              <Icon name="menu" size={24} />
            </Link>
            <Link href={home} className={s.mobileLogo} aria-label={`${p.brand.name} — صفحه اصلی`}>
              {p.brand.name}
              <span className={s.logoDot}>.</span>
            </Link>
          </div>
          <div className={s.mobileGroup}>
            {p.signedIn && wallet !== null ? (
              <Link href={p.links.wallet} className={s.walletShort}>
                <Icon name="account_balance_wallet" size={18} className={s.walletIcon} />
                {formatTomanShort(wallet)}
              </Link>
            ) : p.signedIn ? (
              <Link href={p.links.account} className={s.iconLink} aria-label="حساب کاربری">
                <Icon name="person" size={24} />
              </Link>
            ) : (
              <Link href={p.links.login} className={s.walletShort}>
                <Icon name="person" size={18} />
                ورود
              </Link>
            )}
            <Link href={p.links.favorites} className={s.iconLink} aria-label="علاقه‌مندی‌ها">
              <Icon name="favorite" size={24} />
            </Link>
          </div>
        </div>
        <div className={s.mobileSearchWrap}>
          <SearchBox action={p.searchAction} query={p.searchQuery} compact />
        </div>
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

/** Plain GET form: search works before any JavaScript loads; suggestions are added on top later. */
function SearchBox({
  action = '/search',
  query,
  compact,
}: {
  action?: string;
  query?: string;
  compact?: boolean;
}) {
  return (
    <form action={action} role="search" className={compact ? `${s.search} ${s.mobileSearch}` : s.search}>
      <Icon name="search" size={compact ? 21 : 22} className={s.searchIcon} />
      <input
        type="search"
        name="q"
        defaultValue={query}
        aria-label="جست‌وجو"
        placeholder={compact ? 'جست‌وجو در محصولات…' : 'جست‌وجو در محصولات، برندها و دسته‌ها…'}
        className={s.searchInput}
        enterKeyHint="search"
      />
      {!compact && (
        <span className={s.kbd} aria-hidden="true">
          /
        </span>
      )}
    </form>
  );
}

function CartLink({ href, count }: { href: string; count: number }) {
  return (
    <Link
      href={href}
      className={s.iconLink}
      aria-label={count > 0 ? `سبد خرید، ${formatNumber(count)} کالا` : 'سبد خرید'}
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
