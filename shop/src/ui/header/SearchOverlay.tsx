'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '../icon/Icon';
import { SearchBox } from './SearchBox';
import s from './SearchOverlay.module.css';

/**
 * Full-screen search on phones, opened by any link marked data-open-search (the tab bar's «جست‌وجو»). The link still
 * goes to /search without JavaScript. The dialog is always in the page (hidden), so a tap opens it and focuses the
 * field in the same user gesture — the only way iOS Safari raises the keyboard. Esc, the close button or the
 * backdrop closes it; focus returns to the link.
 */
export function SearchOverlay({ action, query }: { action?: string; query?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('[data-open-search]');
      const d = dialog.current;
      if (!link || !d || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // capture phase, before React's own listener: the link's client-side navigation never starts
      e.preventDefault();
      e.stopPropagation();
      if (!d.open) d.showModal();
      d.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
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
          <SearchBox action={action} query={query} compact />
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
