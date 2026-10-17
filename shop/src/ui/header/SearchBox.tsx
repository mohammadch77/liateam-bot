'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatToman } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import { highlight, normalizeSearch } from '@/lib/search/normalize';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import s from './SearchBox.module.css';

/** Shape of GET /api/search/suggest (Suggestions in the catalog service). */
type Suggestions = {
  query: string;
  words: string[];
  products: Array<{
    href: string;
    name: string;
    brand: string | null;
    imageUrl: string | null;
    priceToman: number;
    inStock: boolean;
  }>;
  categories: Array<{ name: string; href: string; parent: string | null }>;
  total: number;
};
type State =
  | { kind: 'idle' }
  | { kind: 'loading'; previous: Suggestions | null }
  | { kind: 'ready'; data: Suggestions }
  | { kind: 'error' };

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;
const MAX_CHARS = 60;

/**
 * Header search: a plain GET form to /search (works before JavaScript loads; Enter always shows the full,
 * relevance-ranked results) with search-as-you-type suggestions on top. ARIA 1.2 combobox: ↑/↓ move through
 * the suggestions, Enter opens the highlighted one, Esc closes the list; «/» focuses the box (desktop).
 */
export function SearchBox({
  action = '/search',
  query,
  compact,
  suggestUrl = '/api/search/suggest',
}: {
  action?: string;
  query?: string;
  compact?: boolean;
  suggestUrl?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query ?? '');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLFormElement>(null);
  const cacheRef = useRef(new Map<string, Suggestions>());
  const listId = useId();
  const optId = (i: number) => `${listId}-o${i}`;

  // fetch suggestions for the typed text: debounced, stale responses aborted, answers cached per query
  const key = normalizeSearch(value);
  useEffect(() => {
    if (key.length < MIN_CHARS) return;
    const hit = cacheRef.current.get(key);
    const ctrl = new AbortController();
    const t = setTimeout(
      async () => {
        if (hit) return setState({ kind: 'ready', data: hit });
        setState((st) => ({
          kind: 'loading',
          previous: st.kind === 'ready' ? st.data : st.kind === 'loading' ? st.previous : null,
        }));
        try {
          const res = await fetch(`${suggestUrl}?q=${encodeURIComponent(value.trim().slice(0, MAX_CHARS))}`, {
            signal: ctrl.signal,
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as Suggestions;
          cacheRef.current.set(key, data);
          setState({ kind: 'ready', data });
        } catch {
          if (!ctrl.signal.aborted) setState({ kind: 'error' });
        }
      },
      hit ? 0 : DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // value is read only for the request text; the key decides when to search
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, suggestUrl]);

  // «/» focuses the search box from anywhere (not while typing elsewhere)
  useEffect(() => {
    if (compact) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [compact]);

  // a click or tap outside closes the list
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const tooShort = key.length < MIN_CHARS;
  const data = tooShort
    ? null
    : state.kind === 'ready'
      ? state.data
      : state.kind === 'loading'
        ? state.previous
        : null;
  const loading = !tooShort && state.kind === 'loading';
  const words = data?.words ?? [];
  const marked = (text: string) =>
    highlight(text, words).map((seg, k) =>
      seg.hit ? (
        <b key={k} className={s.hit}>
          {seg.text}
        </b>
      ) : (
        seg.text
      ),
    );

  // the options, in screen order: matching categories, products, «all results»
  const options: Array<{ href: string; className: string | undefined; content: ReactNode }> = data
    ? [
        ...data.categories.map((c) => ({
          href: c.href,
          className: s.catRow,
          content: (
            <>
              <Icon name="category" size={18} className={s.catIcon} />
              <span className={s.catText}>
                {marked(c.name)}
                {c.parent && <span className={s.muted}> در {c.parent}</span>}
              </span>
            </>
          ),
        })),
        ...data.products.map((p) => ({
          href: p.href,
          className: s.productRow,
          content: (
            <>
              <span className={s.thumb}>
                {p.imageUrl ? (
                  <Image src={p.imageUrl} alt="" width={40} height={40} className={s.thumbImg} />
                ) : null}
              </span>
              <span className={s.productText}>
                <span className={s.productName}>{marked(p.name)}</span>
                {p.brand && <span className={s.brand}>{marked(p.brand)}</span>}
              </span>
              {p.inStock ? (
                <span className={s.price}>
                  {formatToman(p.priceToman)} <span className={s.unit}>تومان</span>
                </span>
              ) : (
                <span className={s.soldOut}>ناموجود</span>
              )}
            </>
          ),
        })),
        ...(data.total > 0
          ? [
              {
                href: searchHref(action, value),
                className: s.allRow,
                content: (
                  <>
                    مشاهده‌ی همه‌ی {formatNumber(data.total)} نتیجه برای «{value.trim()}»
                    <Icon name="arrow_back" size={18} />
                  </>
                ),
              },
            ]
          : []),
      ]
    : [];
  const showList = open && !tooShort && (data !== null || loading || state.kind === 'error');
  const activeIndex = active < options.length ? active : -1;

  const go = (href: string) => {
    setOpen(false);
    input.current?.blur();
    router.push(href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      // wraps around: ↓ from the last goes to the first, ↑ from the first (or from the input) to the last
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1 >= n ? 0 : i + 1) : i - 1 < 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && showList && activeIndex >= 0) {
      e.preventDefault();
      const target = options[activeIndex];
      if (target) go(target.href);
    } else if (e.key === 'Escape') {
      if (showList) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  };

  return (
    <form
      ref={root}
      action={action}
      role="search"
      className={cx(s.search, compact && s.compact)}
      onSubmit={(e) => {
        if (!value.trim()) {
          e.preventDefault();
          input.current?.focus();
          return;
        }
        setOpen(false);
      }}
    >
      <Icon name="search" size={compact ? 21 : 22} className={s.icon} />
      <input
        ref={input}
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label="جست‌وجو"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && activeIndex >= 0 ? optId(activeIndex) : undefined}
        placeholder={compact ? 'جست‌وجو در محصولات…' : 'جست‌وجو در محصولات، برندها و دسته‌ها…'}
        className={s.input}
        enterKeyHint="search"
        maxLength={80}
        autoComplete="off"
        spellCheck={false}
      />
      {!compact && (
        <span className={s.kbd} aria-hidden="true">
          /
        </span>
      )}

      <div className={s.popup} hidden={!showList}>
        <ul id={listId} role="listbox" aria-label="پیشنهادهای جست‌وجو" aria-busy={loading} className={s.list}>
          {options.map((o, i) => (
            <li
              key={`${i}-${o.href}`}
              id={optId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={cx(o.className, i === activeIndex && s.active)}
              onPointerDown={(e) => e.preventDefault()} // keep focus in the input
              onPointerEnter={() => setActive(i)}
              onClick={() => go(o.href)}
            >
              {o.content}
            </li>
          ))}
        </ul>
        {loading && !data && (
          <div className={s.skeleton} aria-hidden="true">
            {[0, 1, 2].map((k) => (
              <span key={k} className={s.skelRow}>
                <span className={s.skelThumb} />
                <span className={s.skelLine} />
              </span>
            ))}
          </div>
        )}
        {data && !data.total && !data.categories.length && (
          <p className={s.empty}>
            <Icon name="search_off" size={20} />
            نتیجه‌ای برای «{value.trim()}» پیدا نشد. املای دیگری را امتحان کنید.
          </p>
        )}
        {state.kind === 'error' && !data && (
          <p className={s.empty}>پیشنهادها در دسترس نیست؛ Enter را بزنید.</p>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {showList && data ? (data.total ? `${formatNumber(data.total)} نتیجه` : 'نتیجه‌ای پیدا نشد') : ''}
      </span>
    </form>
  );
}

function searchHref(action: string, q: string): string {
  return `${action}?q=${encodeURIComponent(q.trim())}`;
}
