'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { formatNumber } from '@/lib/format/number';
import { Icon } from '../icon/Icon';
import type { NavItem } from './Header';
import s from './MobileMenu.module.css';

/**
 * Mobile menu (below 1024px): the header's ☰ opens a side drawer with the categories as an accordion — a
 * top-level category opens to show its sub-categories. A modal <dialog>: focus stays inside, Esc closes it,
 * a tap on the backdrop or a followed link closes it. (Without JavaScript the tab bar's «دسته‌ها» still works.)
 */
export function MobileMenu({
  items,
  allHref,
  brandName,
}: {
  items: readonly NavItem[];
  allHref: string;
  brandName: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const pathname = usePathname();

  useEffect(() => dialog.current?.close(), [pathname]);

  if (!items.length) {
    return (
      <Link href={allHref} className={s.button} aria-label="منو">
        <Icon name="menu" size={24} />
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={s.button}
        aria-label="منو"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => dialog.current?.showModal()}
      >
        <Icon name="menu" size={24} />
      </button>
      <dialog
        ref={dialog}
        className={s.drawer}
        aria-labelledby={titleId}
        onToggle={(e) => setOpen(e.currentTarget.open)}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // the backdrop is the dialog element itself; a followed link closes the drawer too
          if (e.target === e.currentTarget || (e.target as Element).closest('a')) dialog.current?.close();
        }}
      >
        <div className={s.sheet}>
          <div className={s.head}>
            <span id={titleId} className={s.title}>
              {brandName}
              <span className={s.dot}>.</span>
            </span>
            <button
              type="button"
              className={s.close}
              aria-label="بستن منو"
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" size={24} />
            </button>
          </div>
          <nav aria-label="دسته‌بندی کالاها" className={s.body}>
            <span className={s.section}>دسته‌بندی کالاها</span>
            <ul className={s.list}>
              {items.map((c) => {
                const children = c.children ?? [];
                if (!children.length) {
                  return (
                    <li key={c.href}>
                      <Link href={c.href} className={s.row}>
                        <span className={s.label}>{c.label}</span>
                        <Icon name="chevron_left" size={20} className={s.muted} />
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={c.href}>
                    <details name="mobile-categories" className={s.group}>
                      <summary className={s.row}>
                        <span className={s.label}>{c.label}</span>
                        <Icon name="keyboard_arrow_down" size={22} className={s.arrow} />
                      </summary>
                      <ul className={s.children}>
                        <li>
                          <Link href={c.href} className={s.allOf}>
                            همه محصولات {c.label}
                            {c.count != null && <span className={s.count}>{formatNumber(c.count)}</span>}
                          </Link>
                        </li>
                        {children.map((ch) => (
                          <li key={ch.href}>
                            <Link href={ch.href} className={s.child}>
                              {ch.label}
                              {ch.count != null && <span className={s.count}>{formatNumber(ch.count)}</span>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
            <Link href={allHref} className={s.allCats}>
              <Icon name="grid_view" size={20} />
              همه‌ی دسته‌بندی‌ها
            </Link>
          </nav>
        </div>
      </dialog>
    </>
  );
}
