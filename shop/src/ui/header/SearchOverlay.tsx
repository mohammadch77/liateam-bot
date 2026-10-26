'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon } from '../icon/Icon';
import { SearchBox } from './SearchBox';
import s from './SearchOverlay.module.css';

/**
 * Full-screen search on phones, opened by any link marked data-open-search (the tab bar's «جست‌وجو»). The link still
 * goes to /search without JavaScript. The dialog is always in the page (hidden), so a tap opens it and focuses the
 * field in the same user gesture — the only way iOS Safari raises the keyboard.
 *
 * Stable with the keyboard up: iOS does not shrink the layout viewport for the keyboard, it scrolls it, which moved a
 * 100dvh dialog around. The dialog is therefore sized and placed from `visualViewport` (the visible part) on every
 * resize/scroll, the page behind is locked, the field sits in a fixed bar and the results scroll inside their own
 * panel. Esc, the close button or the backdrop closes it; it also closes when a result is followed or the page changes.
 */
export function SearchOverlay({ action, query }: { action?: string; query?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => dialog.current?.close(), [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('[data-open-search]');
      const d = dialog.current;
      if (!link || !d || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // capture phase, before React's own listener: the link's client-side navigation never starts
      e.preventDefault();
      e.stopPropagation();
      if (!d.open) d.showModal();
      d.querySelector<HTMLInputElement>('input')?.focus();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // follow the visible area while the dialog is open
  useEffect(() => {
    const d = dialog.current;
    const vv = window.visualViewport;
    if (!d || !vv) return;
    const sync = () => {
      if (!d.open) return;
      d.style.height = `${Math.round(vv.height)}px`;
      d.style.top = `${Math.round(vv.offsetTop)}px`;
      // the page behind must not drift while the keyboard opens
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const onClose = () => {
      d.style.height = '';
      d.style.top = '';
      document.documentElement.classList.remove('drawer-open');
    };
    const mo = new MutationObserver(() => {
      if (!d.open) return;
      document.documentElement.classList.add('drawer-open');
      sync();
    });
    mo.observe(d, { attributes: true, attributeFilter: ['open'] });
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    d.addEventListener('close', onClose);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      d.removeEventListener('close', onClose);
      mo.disconnect();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-label="جست‌وجو"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close(); // the backdrop
      }}
      onKeyDown={(e) => {
        // Esc: the field uses it first to close its suggestions (and marks it handled); otherwise it closes the dialog
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          e.currentTarget.close();
        }
      }}
      data-search-overlay
    >
      <div className={s.bar}>
        <div className={s.box}>
          <SearchBox
            action={action}
            query={query}
            compact
            overlay
            onNavigate={() => dialog.current?.close()}
          />
        </div>
        <button
          type="button"
          className={s.close}
          aria-label="بستن جست‌وجو"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" size={24} />
        </button>
      </div>
    </dialog>
  );
}
