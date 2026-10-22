'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '@/lib/format/number';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { NavItem } from './Header';
import { MenuOpen, NavProductGrid, PreviewImage, arrowKeys } from './NavProducts';
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
  links,
  children,
}: {
  label: string;
  href: string;
  panelLabel: string;
  /** plain links kept in the page's HTML before the first open (crawlers, no JavaScript): no panes, no pictures */
  links: readonly NavItem[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [built, setBuilt] = useState(false);
  if (open && !built) setBuilt(true); // adjusted during render: the first open builds the content
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
        {/* the panel's content is built on the first open, not with every page (smaller page, less start-up work) */}
        {built ? (
          <MenuOpen.Provider value={open}>{children}</MenuOpen.Provider>
        ) : (
          <ul className={s.seoLinks}>
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        )}
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
    <NavMenu label={label} href={href} panelLabel={`دسته‌بندی‌های ${label}`} links={items}>
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
      <ul className={s.roots} aria-label="دسته‌بندی‌های اصلی" onKeyDown={arrowKeys}>
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

/**
 * Sub-categories of the active category, the products of the sub-category under the pointer / focus (the first one
 * until then: the only one loaded ahead), and the cover tile, which shows the hovered product's picture.
 */
function Pane({ item }: { item: NavItem }) {
  const children = item.children ?? [];
  // a category without sub-categories shows its own products
  const targets = children.length ? children : [item];
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const intent = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(intent.current), []);
  const target = targets[Math.min(active, targets.length - 1)]!;
  const choose = (i: number, now = false) => {
    clearTimeout(intent.current);
    if (now) setActive(i);
    else intent.current = setTimeout(() => setActive(i), ACTIVATE_DELAY_MS);
  };
  return (
    <div className={s.pane}>
      <div className={s.paneMain}>
        <Link href={item.href} className={s.paneAll}>
          همه محصولات {item.label}
          {item.count != null && <span className={s.paneCount}>({formatNumber(item.count)})</span>}
          <Icon name="chevron_left" size={18} />
        </Link>
        {children.length > 0 && (
          <ul className={s.children} aria-label={`زیردسته‌های ${item.label}`} onKeyDown={arrowKeys}>
            {children.map((ch, i) => (
              <li key={ch.href}>
                <Link
                  href={ch.href}
                  className={cx(s.child, i === active && s.childActive)}
                  onPointerEnter={() => choose(i)}
                  onPointerLeave={() => clearTimeout(intent.current)}
                  onFocus={() => choose(i, true)}
                  aria-describedby={i === active ? 'nav-products-of' : undefined}
                >
                  {ch.label}
                  {ch.count != null && <span className={s.childCount}>{formatNumber(ch.count)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <span id="nav-products-of" className={s.productsTitle}>
          پرفروش‌های {target.label}
        </span>
        <NavProductGrid
          title={target.label}
          target={target.code != null ? { cat: target.code } : null}
          onPreview={setPreview}
        />
      </div>
      <Link href={item.href} className={s.promo} tabIndex={-1} aria-hidden="true">
        <PreviewImage base={item.imageUrl ?? null} preview={preview} />
        <b className={s.promoTitle}>{item.label}</b>
        <span className={s.promoCta}>
          مشاهده
          <Icon name="arrow_back" size={17} />
        </span>
      </Link>
    </div>
  );
}

/** «برندها»: the label goes to the brands page; the panel: every brand, the hovered brand's products and picture. */
export function BrandMenu({ items, href }: { items: readonly NavItem[]; href: string }) {
  if (!items.length) {
    return (
      <Link href={href} className={cx(s.trigger, s.triggerLink)}>
        برندها
      </Link>
    );
  }
  return (
    <NavMenu label="برندها" href={href} panelLabel="فهرست برندها" links={items}>
      <BrandPanel items={items} href={href} />
    </NavMenu>
  );
}

function BrandPanel({ items, href }: { items: readonly NavItem[]; href: string }) {
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const intent = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(intent.current), []);
  const brand = items[Math.min(active, items.length - 1)]!;
  const choose = (i: number, now = false) => {
    clearTimeout(intent.current);
    if (now) setActive(i);
    else intent.current = setTimeout(() => setActive(i), ACTIVATE_DELAY_MS);
  };
  return (
    <div className={s.inner} data-brand-panel>
      <ul className={s.roots} aria-label="برندها" onKeyDown={arrowKeys}>
        {items.map((b, i) => (
          <li key={b.href} className={s.rootItem}>
            <Link
              href={b.href}
              className={cx(s.rootLink, i === active && s.rootActive)}
              aria-current={b.current ? 'page' : undefined}
              onPointerEnter={() => choose(i)}
              onPointerLeave={() => clearTimeout(intent.current)}
              onFocus={() => choose(i, true)}
              data-nav-brand={b.code}
            >
              <span className={s.rootLabel}>{b.label}</span>
              {b.count != null && <span className={s.childCount}>{formatNumber(b.count)}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <div className={s.pane}>
        <div className={s.paneMain}>
          <Link href={brand.href} className={s.paneAll}>
            همه محصولات {brand.label}
            <Icon name="chevron_left" size={18} />
          </Link>
          <NavProductGrid
            title={brand.label}
            target={brand.code != null ? { brand: brand.code } : null}
            onPreview={setPreview}
          />
        </div>
        <Link href={brand.href} className={cx(s.promo, s.brandPromo)} tabIndex={-1} aria-hidden="true">
          {preview ? (
            <PreviewImage base={null} preview={preview} />
          ) : (
            brand.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- SVG logo served by our own route
              <img src={brand.imageUrl} alt="" className={s.brandPromoLogo} />
            )
          )}
          <b className={s.promoTitle}>{brand.label}</b>
          <span className={s.promoCta}>
            مشاهده
            <Icon name="arrow_back" size={17} />
          </span>
        </Link>
      </div>
      <Link href={href} className={s.all}>
        همه‌ی برندها
        <Icon name="chevron_left" size={18} />
      </Link>
    </div>
  );
}
