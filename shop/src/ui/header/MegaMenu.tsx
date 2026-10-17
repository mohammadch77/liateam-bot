'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
 * «دسته‌بندی کالاها» mega menu (SiteHeader.dc.html, desktop only). Disclosure pattern: a button with
 * aria-expanded opens a panel laid over the page (absolute, so nothing moves). Opens on hover and on click;
 * closes on Esc (focus returns to the button), a click outside, focus leaving it, or navigation.
 *
 * In the DOM each top-level category is followed by its own sub-category pane, so Tab walks «category → its
 * sub-categories → next category»; focusing or hovering a category makes it the active one.
 */
export function MegaMenu({ items, allHref }: { items: readonly NavItem[]; allHref: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // index of the category whose sub-categories show
  const pinned = useRef(false); // opened by a click: hover-out must not close it
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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

  useEffect(
    () => () => {
      clearTimeout(closeTimer.current);
      clearTimeout(activateTimer.current);
    },
    [],
  );

  if (!items.length) {
    return (
      <Link href={allHref} className={s.trigger}>
        <Icon name="menu" size={22} />
        دسته‌بندی کالاها
      </Link>
    );
  }

  const shown = Math.min(active, items.length - 1);
  return (
    <div
      ref={root}
      className={s.root}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        clearTimeout(closeTimer.current);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse' || pinned.current) return;
        closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={button}
        type="button"
        className={cx(s.trigger, open && s.triggerOpen)}
        aria-expanded={open}
        aria-controls={panelId}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setOpen(true);
        }}
        onClick={() => {
          // a click on a menu the hover just opened keeps it open (and pins it); otherwise it toggles
          if (open && pinned.current) return close();
          pinned.current = true;
          setOpen(true);
        }}
      >
        <Icon name="menu" size={22} />
        دسته‌بندی کالاها
      </button>

      <div
        id={panelId}
        className={s.panel}
        hidden={!open}
        onClick={(e) => {
          if ((e.target as Element).closest('a')) close(); // a followed link (also to the current page)
        }}
      >
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
      </div>
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
        {item.imageUrl && (
          <Image src={item.imageUrl} alt="" fill sizes="264px" className={s.promoImage} />
        )}
        <b className={s.promoTitle}>{item.label}</b>
        <span className={s.promoCta}>
          مشاهده
          <Icon name="arrow_back" size={17} />
        </span>
      </Link>
    </div>
  );
}
