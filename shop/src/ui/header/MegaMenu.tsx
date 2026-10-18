'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '@/lib/format/number';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { NavItem } from './Header';
import s from './MegaMenu.module.css';

const CLOSE_DELAY_MS = 180;
/** hover intent: a category becomes active only when the pointer rests on it, so moving diagonally towards the
 *  sub-categories across other rows does not switch the pane */
const ACTIVATE_DELAY_MS = 110;

/**
 * A header bar item with a panel laid over the page (SiteHeader.dc.html, desktop only), like Liateam's
 * «فروشگاه» / «برندها». The label is a real link (its page: all products, all brands); hovering the item opens the
 * panel. Beside it a small chevron button (disclosure pattern, aria-expanded) opens it by click, keyboard or touch.
 * The panel closes on Esc (focus returns to the chevron), a click outside, focus leaving it, or navigation.
 */
function NavMenu({
  label,
  href,
  panelLabel,
  children,
}: {
  label: string;
  href: string;
  panelLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false); // opened by a click: hover-out must not close it
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  const close = useCallback((refocus = false) => {
    clearTimeout(closeTimer.current);
    pinned.current = false;
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // any navigation (back/forward included) closes the menu: adjusted during render, not in an effect
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const hoverOpen = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimer.current);
    setOpen(true);
  };

  return (
    <div
      ref={root}
      className={s.root}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse' || pinned.current) return;
        closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <span className={cx(s.trigger, open && s.triggerOpen)} onPointerEnter={hoverOpen}>
        <Link href={href} className={s.triggerLink} aria-current={pathname === href ? 'page' : undefined}>
          {label}
        </Link>
        <button
          ref={button}
          type="button"
          className={s.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={panelLabel}
          onClick={() => {
            // a click on a menu the hover just opened keeps it open (and pins it); otherwise it toggles
            if (open && pinned.current) return close();
            pinned.current = true;
            setOpen(true);
          }}
        >
          <Icon name="keyboard_arrow_down" size={20} className={s.toggleIcon} />
        </button>
      </span>

      <div
        id={panelId}
        className={s.panel}
        hidden={!open}
        onPointerEnter={() => clearTimeout(closeTimer.current)}
        onClick={(e) => {
          if ((e.target as Element).closest('a')) close(); // a followed link (also to the current page)
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** «فروشگاه»: the label goes to all products; the panel is the category tree (categories → sub-categories). */
export function MegaMenu({
  items,
  label = 'فروشگاه',
  href,
  allHref,
}: {
  items: readonly NavItem[];
  label?: string;
  href: string;
  allHref: string;
}) {
  if (!items.length) {
    return (
      <Link href={href} className={cx(s.trigger, s.triggerLink)}>
        {label}
      </Link>
    );
  }
  return (
    <NavMenu label={label} href={href} panelLabel={`دسته‌بندی‌های ${label}`}>
      <CategoryPanel items={items} allHref={allHref} />
    </NavMenu>
  );
}

/**
 * In the DOM each top-level category is followed by its own sub-category pane, so Tab walks «category → its
 * sub-categories → next category»; focusing or hovering a category makes it the active one.
 */
function CategoryPanel({ items, allHref }: { items: readonly NavItem[]; allHref: string }) {
  const [active, setActive] = useState(0); // index of the category whose sub-categories show
  const activateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(activateTimer.current), []);
  const shown = Math.min(active, items.length - 1);
  return (
    <div className={s.inner}>
      <ul className={s.roots} aria-label="دسته‌بندی‌های اصلی">
        {items.map((c, i) => (
          <li key={c.href} className={s.rootItem}>
            <Link
              href={c.href}
              className={cx(s.rootLink, i === shown && s.rootActive)}
              aria-current={c.current ? 'page' : undefined}
              onPointerEnter={() => {
                clearTimeout(activateTimer.current);
                activateTimer.current = setTimeout(() => setActive(i), ACTIVATE_DELAY_MS);
              }}
              onPointerLeave={() => clearTimeout(activateTimer.current)}
              onFocus={() => setActive(i)}
            >
              <span className={s.rootLabel}>{c.label}</span>
              <Icon name="chevron_left" size={18} className={s.chevron} />
            </Link>
            {i === shown && <Pane item={c} />}
          </li>
        ))}
      </ul>
      <Link href={allHref} className={s.all}>
        همه‌ی دسته‌بندی‌ها
        <Icon name="chevron_left" size={18} />
      </Link>
    </div>
  );
}

/** Sub-categories of the active category, with its cover tile. */
function Pane({ item }: { item: NavItem }) {
  const children = item.children ?? [];
  return (
    <div className={s.pane}>
      <div className={s.paneMain}>
        <Link href={item.href} className={s.paneAll}>
          همه محصولات {item.label}
          {item.count != null && <span className={s.paneCount}>({formatNumber(item.count)})</span>}
          <Icon name="chevron_left" size={18} />
        </Link>
        {children.length > 0 && (
          <ul className={s.children} aria-label={`زیردسته‌های ${item.label}`}>
            {children.map((ch) => (
              <li key={ch.href}>
                <Link href={ch.href} className={s.child}>
                  {ch.label}
                  {ch.count != null && <span className={s.childCount}>{formatNumber(ch.count)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link href={item.href} className={s.promo} tabIndex={-1} aria-hidden="true">
        {item.imageUrl && <Image src={item.imageUrl} alt="" fill sizes="264px" className={s.promoImage} />}
        <b className={s.promoTitle}>{item.label}</b>
        <span className={s.promoCta}>
          مشاهده
          <Icon name="arrow_back" size={17} />
        </span>
      </Link>
    </div>
  );
}

/** «برندها»: the label goes to the brands page; the panel lists every brand (logo, name, product count). */
export function BrandMenu({ items, href }: { items: readonly NavItem[]; href: string }) {
  if (!items.length) {
    return (
      <Link href={href} className={cx(s.trigger, s.triggerLink)}>
        برندها
      </Link>
    );
  }
  return (
    <NavMenu label="برندها" href={href} panelLabel="فهرست برندها">
      <div className={s.inner}>
        <ul className={s.brands} aria-label="برندها">
          {items.map((b) => (
            <li key={b.href}>
              <Link href={b.href} className={s.brand} aria-current={b.current ? 'page' : undefined}>
                <span className={s.brandLogo}>
                  {b.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- SVG logo served by our own route
                    <img src={b.imageUrl} alt="" width={96} height={40} />
                  ) : (
                    <Icon name="spa" size={28} />
                  )}
                </span>
                <span className={s.brandName}>{b.label}</span>
                {b.count != null && <span className={s.childCount}>{formatNumber(b.count)} محصول</span>}
              </Link>
            </li>
          ))}
        </ul>
        <Link href={href} className={s.all}>
          همه‌ی برندها
          <Icon name="chevron_left" size={18} />
        </Link>
      </div>
    </NavMenu>
  );
}
