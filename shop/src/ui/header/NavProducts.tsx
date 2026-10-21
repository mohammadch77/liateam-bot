'use client';

import Image from 'next/image';
import Link from 'next/link';
import { createContext, useContext, useEffect, useState, type KeyboardEvent } from 'react';
import { discountPercent } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { Icon } from '../icon/Icon';
import { Price } from '../price/Price';
import { Skeleton } from '../skeleton/Skeleton';
import s from './MegaMenu.module.css';

/** What /api/nav/products returns (public fields only). */
export type NavProduct = {
  id: number;
  href: string;
  name: string;
  imageUrl: string | null;
  priceToman: number;
  oldPriceToman: number | null;
  inStock: boolean;
};
type NavProducts = { items: NavProduct[]; more: boolean; allHref: string };
export type NavTarget = { cat: number } | { brand: number };

/** Whether the menu around a pane is open: nothing is loaded while it is closed. */
export const MenuOpen = createContext(false);

const WIDE_FROM = 1280; // src/lib/bestsellers.ts NAV_LIMITS (6 cards from here, 4 below)

/** 6 cards from 1280 px, 4 below; follows the window size. */
export function useNavLimit(): number {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_FROM}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide ? 6 : 4;
}

/** Responses kept for the session (a pane opened again shows at once). */
const sessionCache = new Map<string, NavProducts>();
const keyOf = (t: NavTarget, limit: number) =>
  ('cat' in t ? `cat=${t.cat}` : `brand=${t.brand}`) + `&limit=${limit}`;

/**
 * The products of one menu target. A new target cancels the request still running for the previous one (fast hover
 * changes never race), and a target already loaded in this session comes from memory.
 */
export function useNavProducts(target: NavTarget | null, limit: number) {
  const key = target ? keyOf(target, limit) : null;
  // results land here (from the request's callbacks only); what is in the session cache is read during render
  const [loaded, setLoaded] = useState<{ key: string; data: NavProducts | null; failed: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!key || sessionCache.has(key)) return;
    const ctrl = new AbortController();
    fetch(`/api/nav/products?${key}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: NavProducts) => {
        sessionCache.set(key, d);
        setLoaded({ key, data: d, failed: false });
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setLoaded({ key, data: null, failed: true });
      });
    return () => ctrl.abort();
  }, [key]);
  const cached = key ? sessionCache.get(key) : undefined;
  if (cached) return { data: cached, failed: false };
  return loaded?.key === key ? { data: loaded.data, failed: loaded.failed } : { data: null, failed: false };
}

/** Arrow keys move the focus between the links of a list / grid (Tab still walks them in order). */
export function arrowKeys(e: KeyboardEvent<HTMLElement>) {
  const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowLeft: 1, ArrowRight: -1 }; // RTL
  const step = keys[e.key];
  if (!step) return;
  // only the list's own items (a category's pane sits inside its item: its links are not siblings)
  const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>(':scope > li > a[href]')];
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (at < 0) return;
  e.stopPropagation();
  e.preventDefault();
  links[(at + step + links.length) % links.length]?.focus();
}

/**
 * A pane's product cards (picture, name in two lines, price with the struck-through one, «ناموجود»), skeleton cards
 * of the same size while loading, «مشاهده همه» only when there are more than shown. `onPreview` gets the picture of
 * the card under the pointer / focus (the pane's big image shows it), null when it leaves.
 */
export function NavProductGrid({
  title,
  target,
  onPreview,
}: {
  title: string;
  target: NavTarget | null;
  onPreview: (imageUrl: string | null) => void;
}) {
  const limit = useNavLimit();
  const open = useContext(MenuOpen);
  const { data, failed } = useNavProducts(open ? target : null, limit);
  if (!target) return null;
  return (
    <section
      className={s.products}
      aria-label={`محصولات ${title}`}
      aria-busy={!data && !failed}
      data-nav-products
    >
      {data && data.items.length === 0 ? (
        <p className={s.productsEmpty}>فعلاً محصول موجودی در «{title}» نیست.</p>
      ) : failed ? (
        <p className={s.productsEmpty}>محصولات بارگذاری نشد.</p>
      ) : (
        <ul className={s.productGrid} onKeyDown={arrowKeys} onPointerLeave={() => onPreview(null)}>
          {data
            ? data.items.map((p) => {
                const off = discountPercent(p.priceToman, p.oldPriceToman);
                return (
                  <li key={p.id}>
                    <Link
                      href={p.href}
                      className={s.productCard}
                      onPointerEnter={() => onPreview(p.imageUrl)}
                      onFocus={() => onPreview(p.imageUrl)}
                      onBlur={() => onPreview(null)}
                      data-nav-product={p.id}
                    >
                      <span className={s.productImage}>
                        {p.imageUrl ? (
                          <Image src={p.imageUrl} alt="" fill sizes="120px" />
                        ) : (
                          <Icon name="spa" size={26} />
                        )}
                        {off > 0 && <span className={s.productOff}>{toFaDigits(off)}٪</span>}
                      </span>
                      <span className={s.productName}>{p.name}</span>
                      {p.inStock ? (
                        <Price toman={p.priceToman} oldToman={p.oldPriceToman} size="sm" />
                      ) : (
                        <span className={s.productOut}>ناموجود</span>
                      )}
                    </Link>
                  </li>
                );
              })
            : Array.from({ length: limit }, (_, i) => (
                <li key={i} className={s.productSkeleton} data-skeleton>
                  <Skeleton height="100%" radius={12} />
                </li>
              ))}
        </ul>
      )}
      {data?.more && (
        <Link href={data.allHref} className={s.productsAll} data-nav-all>
          مشاهده همه
          <Icon name="chevron_left" size={18} />
        </Link>
      )}
    </section>
  );
}

/** The pane's big picture: the category / brand picture, or the hovered product's, with a soft cross-fade. */
export function PreviewImage({ base, preview }: { base: string | null; preview: string | null }) {
  return (
    <>
      {base && (
        <Image
          src={base}
          alt=""
          fill
          sizes="264px"
          className={s.promoImage}
          style={{ opacity: preview ? 0 : 1 }}
        />
      )}
      {preview && (
        <Image
          key={preview}
          src={preview}
          alt=""
          fill
          sizes="264px"
          className={`${s.promoImage} ${s.promoSwap}`}
          data-preview-image
        />
      )}
    </>
  );
}
