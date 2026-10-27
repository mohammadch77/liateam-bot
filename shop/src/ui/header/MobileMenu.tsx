'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type TouchEvent } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '@/lib/format/number';
import { Icon, type IconName } from '../icon/Icon';
import type { NavItem } from './Header';
import s from './MobileMenu.module.css';
import { offersPath } from '@/lib/urls';

/** the info pages of the first level: an icon each, by address (any other page gets a plain arrow) */
const PAGE_ICON: Record<string, IconName> = {
  [offersPath()]: 'bolt',
  '/affiliate': 'trending_up',
  '/about': 'verified',
  '/contact': 'call',
  '/help/faq': 'support_agent',
};

type Panel = { kind: 'root' } | { kind: 'category'; item: NavItem } | { kind: 'brands' };

/** A swipe towards the drawer's edge (right in RTL) longer than this, and mostly sideways, closes it. */
const SWIPE_CLOSE_PX = 70;

/**
 * Mobile menu (below 1024px): the header's ☰ opens a full-height drawer with two levels instead of one long list.
 * Level one: «همه‌ی محصولات», the top-level categories (small picture each), «برندها» and the about / contact /
 * FAQ pages. A category with sub-categories opens its own page in the drawer — «همه‌ی محصولات <category>» first,
 * then the sub-categories — with «بازگشت»; «برندها» likewise. A fixed footer: sign in (or the account), the wallet,
 * order tracking. A modal <dialog>: focus stays inside, Esc or a swipe towards the edge closes it, the page behind
 * does not scroll; the content is built on the first open only. (Without JavaScript the tab bar's «دسته‌ها» works.)
 */
export function MobileMenu({
  items,
  allHref,
  shopHref,
  brands,
  brandsHref,
  pages,
  brandName,
  signedIn,
  links,
  supportPhone,
}: {
  items: readonly NavItem[];
  allHref: string;
  shopHref: string;
  brands: readonly NavItem[];
  brandsHref: string;
  pages: readonly { label: string; href: string }[];
  brandName: string;
  signedIn: boolean;
  links: { login: string; account: string; wallet: string; orders: string };
  /** SUPPORT_PHONE (server env); empty = no call button */
  supportPhone?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // the drawer's content (the whole category tree and the brands) is built on the first open, not with every page:
  // a large part of the page's elements and of its start-up work on phones
  const [built, setBuilt] = useState(false);
  const [panel, setPanel] = useState<Panel>({ kind: 'root' });
  const touch = useRef<{ x: number; y: number } | null>(null);
  const titleId = useId();
  const pathname = usePathname();

  useEffect(() => dialog.current?.close(), [pathname]);
  useEffect(() => {
    document.documentElement.classList.toggle('drawer-open', open);
    return () => document.documentElement.classList.remove('drawer-open');
  }, [open]);
  // a new level starts at its top, with focus on its first control (the back button)
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    if (panel.kind !== 'root') body.current?.querySelector<HTMLElement>('[data-menu-back]')?.focus();
  }, [panel]);

  if (!items.length) {
    return (
      <Link href={allHref} className={s.button} aria-label="منو">
        <Icon name="menu" size={24} />
      </Link>
    );
  }

  const close = () => dialog.current?.close();
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    if (dx > SWIPE_CLOSE_PX && Math.abs(dx) > 2 * Math.abs(t.clientY - start.y)) close();
  };

  const back = (label: string) => (
    <button type="button" className={s.back} onClick={() => setPanel({ kind: 'root' })} data-menu-back>
      <Icon name="chevron_right" size={22} />
      بازگشت
      <span className="sr-only"> از {label}</span>
    </button>
  );
  const count = (n?: number) => (n != null ? <span className={s.count}>{formatNumber(n)}</span> : null);

  return (
    <>
      <button
        type="button"
        className={s.button}
        aria-label="منو"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!built) flushSync(() => setBuilt(true));
          dialog.current?.showModal();
          setOpen(true); // not every browser fires «toggle» for a dialog: the page lock must not depend on it
        }}
      >
        <Icon name="menu" size={24} />
      </button>
      <dialog
        ref={dialog}
        className={s.drawer}
        aria-labelledby={titleId}
        onToggle={(e) => setOpen(e.currentTarget.open)}
        onClose={() => {
          setOpen(false);
          setPanel({ kind: 'root' }); // the next open starts at the first level
        }}
        onClick={(e) => {
          // the backdrop is the dialog element itself; a followed link closes the drawer too
          if (e.target === e.currentTarget || (e.target as Element).closest('a')) close();
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        data-mobile-menu={panel.kind}
      >
        {built && (
          <div className={s.sheet}>
            <div className={s.head}>
              <span id={titleId} className={s.title}>
                {brandName}
                <span className={s.dot}>.</span>
              </span>
              <button type="button" className={s.close} aria-label="بستن منو" onClick={close}>
                <Icon name="close" size={24} />
              </button>
            </div>

            <div ref={body} className={s.body}>
              {panel.kind === 'root' && (
                <nav aria-label="منوی اصلی">
                  <Link href={shopHref} className={s.allProducts}>
                    <Icon name="shopping_bag" size={20} />
                    همه‌ی محصولات
                    <Icon name="chevron_left" size={20} className={s.end} />
                  </Link>
                  <span className={s.section}>دسته‌بندی‌ها</span>
                  <ul className={s.list}>
                    {items.map((c) => {
                      const inner = (
                        <>
                          <span className={s.thumb} aria-hidden="true">
                            {c.imageUrl ? (
                              <Image src={c.imageUrl} alt="" width={40} height={40} />
                            ) : (
                              <Icon name="spa" size={20} />
                            )}
                          </span>
                          <span className={s.label}>{c.label}</span>
                          <Icon name="chevron_left" size={20} className={s.muted} />
                        </>
                      );
                      return (
                        <li key={c.href}>
                          {c.children?.length ? (
                            <button
                              type="button"
                              className={s.row}
                              onClick={() => setPanel({ kind: 'category', item: c })}
                              data-menu-category={c.code}
                            >
                              {inner}
                            </button>
                          ) : (
                            <Link href={c.href} className={s.row}>
                              {inner}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <span className={s.section}>برندها</span>
                  <ul className={s.list}>
                    <li>
                      <button
                        type="button"
                        className={s.row}
                        onClick={() => setPanel({ kind: 'brands' })}
                        data-menu-brands
                      >
                        <span className={s.thumb} aria-hidden="true">
                          <Icon name="verified" size={20} />
                        </span>
                        <span className={s.label}>همه‌ی برندها</span>
                        {count(brands.length)}
                        <Icon name="chevron_left" size={20} className={s.muted} />
                      </button>
                    </li>
                  </ul>
                  <span className={s.section}>صفحه‌ها</span>
                  <ul className={s.list} data-menu-pages>
                    {pages.map((x) => (
                      <li key={x.href}>
                        <Link href={x.href} className={s.row}>
                          <span className={s.thumb} aria-hidden="true">
                            <Icon name={PAGE_ICON[x.href] ?? 'chevron_left'} size={20} />
                          </span>
                          <span className={s.label}>{x.label}</span>
                          <Icon name="chevron_left" size={20} className={s.muted} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}

              {panel.kind === 'category' && (
                <nav aria-label={panel.item.label}>
                  {back(panel.item.label)}
                  <h2 className={s.levelTitle}>{panel.item.label}</h2>
                  <Link href={panel.item.href} className={s.allProducts}>
                    همه‌ی محصولات {panel.item.label}
                    {count(panel.item.count)}
                    <Icon name="chevron_left" size={20} className={s.end} />
                  </Link>
                  <ul className={s.list}>
                    {(panel.item.children ?? []).map((ch) => (
                      <li key={ch.href}>
                        <Link href={ch.href} className={s.row}>
                          <span className={s.label}>{ch.label}</span>
                          {count(ch.count)}
                          <Icon name="chevron_left" size={20} className={s.muted} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}

              {panel.kind === 'brands' && (
                <nav aria-label="برندها">
                  {back('برندها')}
                  <h2 className={s.levelTitle}>برندها</h2>
                  <Link href={brandsHref} className={s.allProducts}>
                    همه‌ی برندها
                    <Icon name="chevron_left" size={20} className={s.end} />
                  </Link>
                  <ul className={s.list}>
                    {brands.map((b) => (
                      <li key={b.href}>
                        <Link href={b.href} className={s.row}>
                          <span className={s.label}>{b.label}</span>
                          {count(b.count)}
                          <Icon name="chevron_left" size={20} className={s.muted} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>

            <div className={s.footer}>
              {signedIn ? (
                <Link href={links.account} className={s.foot}>
                  <Icon name="person" size={22} />
                  حساب کاربری
                </Link>
              ) : (
                <Link href={links.login} className={s.foot}>
                  <Icon name="person" size={22} />
                  ورود | ثبت‌نام
                </Link>
              )}
              <Link href={links.wallet} className={s.foot}>
                <Icon name="account_balance_wallet" size={22} />
                کیف پول
              </Link>
              <Link href={links.orders} className={s.foot}>
                <Icon name="local_shipping" size={22} />
                پیگیری سفارش
              </Link>
              {supportPhone && (
                <a href={`tel:${supportPhone.replace(/[^\d+]/g, '')}`} className={s.foot} data-support-phone>
                  <Icon name="call" size={22} />
                  تماس با پشتیبانی
                </a>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
