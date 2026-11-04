'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatToman } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import { highlight, normalizeSearch } from '@/lib/search/normalize';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import s from './SearchBox.module.css';
import { searchPath } from '@/lib/urls';

/** Shape of GET /api/search/suggest (Suggestions in the catalog service). */
type Product = {
  href: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  priceToman: number;
  oldPriceToman: number | null;
  stock: 'in' | 'limited' | 'out';
};
type Group = { name: string; href: string; imageUrl: string | null; count: number; parent?: string | null };
type Suggestions = {
  query: string;
  words: string[];
  products: Product[];
  categories: Group[];
  brands: Group[];
  total: number;
  fallback: { categories: Group[]; products: Product[] } | null;
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
 * the suggestions, Enter opens the highlighted one, Esc closes the list.
 */
export function SearchBox({
  action = searchPath(),
  query,
  compact,
  overlay,
  onNavigate,
  suggestUrl = '/api/search/suggest',
}: {
  action?: string;
  query?: string;
  compact?: boolean;
  /** inside the full-screen search dialog: the results fill the room under the field and scroll on their own */
  overlay?: boolean;
  /** called when a suggestion is followed or the form is submitted (the dialog closes itself) */
  onNavigate?: () => void;
  suggestUrl?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query ?? '');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0); // «تلاش دوباره» after an error
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
  }, [key, suggestUrl, retry]);

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

  // the options, in screen order, each a card: matching categories, brands, products, «all results»; nothing found: a way on
  type Option = { group: string; href: string; className: string | undefined; content: ReactNode };
  // a matching category or brand is a small chip above the products (one tap to its page), never in the place of a product
  const groupCard = (g: Group, kind: 'cat' | 'brand'): Option => ({
    group: kind,
    href: g.href,
    className: s.chip,
    content: (
      <>
        <Icon name={kind === 'cat' ? 'category' : 'verified'} size={16} className={s.catIcon} />
        <span>{marked(g.name)}</span>
        <span className={s.chipCount}>{formatNumber(g.count)}</span>
      </>
    ),
  });
  const productCard = (p: Product, group: string): Option => ({
    group,
    href: p.href,
    className: cx(s.card, p.stock === 'out' && s.cardOut),
    content: (
      <>
        <span className={s.thumb}>
          {p.imageUrl ? (
            <Image src={p.imageUrl} alt="" width={72} height={72} className={s.thumbImg} />
          ) : (
            <Icon name="spa" size={30} className={s.catIcon} />
          )}
        </span>
        <span className={s.productText}>
          <span className={s.productName}>{marked(p.name)}</span>
          {p.brand && <span className={s.brand}>{marked(p.brand)}</span>}
          {p.stock === 'limited' && <span className={s.limited}>موجودی محدود</span>}
        </span>
        {p.stock === 'out' ? (
          <span className={s.soldOut}>ناموجود</span>
        ) : (
          <span className={s.priceBox}>
            <span className={s.price}>
              {formatToman(p.priceToman)} <span className={s.unit}>تومان</span>
            </span>
            {p.oldPriceToman != null && p.oldPriceToman > p.priceToman && (
              <del className={s.oldPrice}>{formatToman(p.oldPriceToman)}</del>
            )}
          </span>
        )}
      </>
    ),
  });
  const options: Option[] = data
    ? [
        ...data.categories.map((c) => groupCard(c, 'cat')),
        ...data.brands.map((b) => groupCard(b, 'brand')),
        ...data.products.map((p) => productCard(p, 'product')),
        ...(data.fallback?.categories ?? []).map((c) => groupCard({ ...c, parent: null }, 'cat')).map((o) => ({ ...o, group: 'fb-cat' })),
        ...(data.fallback?.products ?? []).map((p) => productCard(p, 'fb-product')),
        ...(data.total > 0 || data.categories.length > 0 || data.brands.length > 0
          ? [
              {
                group: 'all',
                href: searchHref(action, value),
                className: s.allRow,
                content: (
                  <>
                    {data.total > 0
                      ? `مشاهده‌ی همه‌ی ${formatNumber(data.total)} نتیجه برای «${value.trim()}»`
                      : `مشاهده‌ی نتایج «${value.trim()}»`}
                    <Icon name="arrow_back" size={18} />
                  </>
                ),
              },
            ]
          : []),
      ]
    : [];
  const GROUP_TITLE: Record<string, string> = {
    product: 'محصولات',
    'fb-cat': 'دسته‌بندی‌های پیشنهادی',
    'fb-product': 'محصولات پیشنهادی',
  };
  const showList = open && !tooShort && (data !== null || loading || state.kind === 'error');
  const activeIndex = active < options.length ? active : -1;

  const go = (href: string) => {
    setOpen(false);
    input.current?.blur();
    onNavigate?.();
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
      className={cx(s.search, compact && s.compact, overlay && s.overlay)}
      onSubmit={(e) => {
        if (!value.trim()) {
          e.preventDefault();
          input.current?.focus();
          return;
        }
        setOpen(false);
        onNavigate?.();
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
      {value && (
        <button
          type="button"
          className={s.clear}
          aria-label="پاک کردن جست‌وجو"
          onClick={() => {
            setValue('');
            setActive(-1);
            setState({ kind: 'idle' });
            input.current?.focus();
          }}
          data-search-clear
        >
          <Icon name="close" size={20} />
        </button>
      )}

      <div className={s.popup} hidden={!showList}>
        <ul id={listId} role="listbox" aria-label="پیشنهادهای جست‌وجو" aria-busy={loading} className={s.list}>
          {options.map((o, i) => (
            <Fragment key={`${i}-${o.href}`}>
              {GROUP_TITLE[o.group] && options[i - 1]?.group !== o.group && (
                <li role="presentation" className={s.groupTitle} data-search-group={o.group}>
                  {GROUP_TITLE[o.group]}
                </li>
              )}
              <li
                id={optId(i)}
                role="option"
                aria-selected={i === activeIndex}
                className={cx(o.className, i === activeIndex && s.active)}
                data-search-card={o.group}
                // mouse: keep focus in the input. Not for touch: cancelling a touch pointerdown makes WebKit (every iPhone
                // browser) drop the tap's click, so a tapped suggestion never opened.
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse') e.preventDefault();
                }}
                onPointerEnter={() => setActive(i)}
                onClick={() => go(o.href)}
              >
                {o.content}
              </li>
            </Fragment>
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
        {data && !data.total && !data.categories.length && !data.brands.length && (
          <p className={s.empty} data-search-empty>
            <Icon name="search_off" size={20} />
            نتیجه‌ای برای «{value.trim()}» پیدا نشد. املای دیگری را امتحان کنید یا از پیشنهادها بروید.
          </p>
        )}
        {state.kind === 'error' && !data && (
          <p className={s.empty} data-search-error>
            پیشنهادها در دسترس نیست.{' '}
            <button type="button" className={s.retry} onClick={() => setRetry((n) => n + 1)}>
              تلاش دوباره
            </button>
          </p>
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
