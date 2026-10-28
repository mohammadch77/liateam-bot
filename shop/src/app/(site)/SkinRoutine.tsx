'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { Carousel, Icon, ProductCard } from '@/ui';
import { AddPackButton } from './_cart/AddPackButton';
import s from './skin-routine.module.css';

/** Only what the section shows (no ids beyond the pack key, no purchase price). */
export type RoutinePack = {
  /** the collection's slug, with the key it finds the pack (the browser sends only these to add it) */
  collection: string;
  key: string;
  variantTitle: string;
  title: string;
  href: string;
  total: number;
  final: number | null;
  saving: number;
  available: boolean;
  steps: Array<{
    label: string;
    status: 'soon' | 'out' | 'ok';
    price: number | null;
    product: { id: number; name: string; href: string; brand: string | null; imageUrl: string | null } | null;
  }>;
};

/**
 * Home «روتین پوستی» (Homepage.dc.html): one tab per skin type (a segmented control that scrolls on phones) and one
 * compact card — the five steps as short rows (small image, step, name, price; a «به‌زودی» step dimmed), the pack
 * price (the items' sum unless the admin gave the pack a discount) and two actions: «افزودن پک به سبد خرید» (adds
 * every available item; a placeholder like the product page's button until the cart exists) and «مشاهده محصولات».
 * Every pack is in the page, so switching is instant; rows have a fixed height (no layout shift).
 */
export function SkinRoutine({
  title,
  subtitle,
  variantLabel,
  packs,
}: {
  /** the collection's title and subtitle, edited in /admin/packs */
  title: string;
  subtitle: string;
  /** what the tabs are called (نوع پوست, نیاز …) */
  variantLabel: string;
  packs: RoutinePack[];
}) {
  const uid = useId();
  const [key, setKey] = useState(packs[0]?.key);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const pack = packs.find((p) => p.key === key) ?? packs[0];
  if (!pack) return null;
  const index = packs.indexOf(pack);
  const ok = pack.steps.filter((x) => x.status === 'ok').length;

  // tabs pattern: ←/→ (RTL: ← is the next tab), Home/End
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    const from = tabs.current.findIndex((t) => t === document.activeElement);
    const at = from >= 0 ? from : index;
    let next = step ? (at + step + packs.length) % packs.length : -1;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = packs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setKey(packs[next]!.key);
    tabs.current[next]?.focus();
  };

  return (
    <section className={s.section} aria-labelledby={`${uid}-title`} data-routine={pack.key}>
      <div className={s.head}>
        <h2 id={`${uid}-title`} className={s.title}>
          {title}
        </h2>
        <p className={s.sub}>
          {subtitle || `${variantLabel} را انتخاب کنید؛ ${toFaDigits(pack.steps.length)} محصول مکمل.`}
        </p>
      </div>

      <div className={s.tabs} role="tablist" aria-label={variantLabel} onKeyDown={onKey}>
        {packs.map((p, i) => (
          <button
            key={p.key}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${p.key}`}
            aria-controls={`${uid}-panel`}
            aria-selected={p.key === pack.key}
            tabIndex={p.key === pack.key ? 0 : -1}
            className={s.tab}
            onClick={() => setKey(p.key)}
          >
            {p.variantTitle}
          </button>
        ))}
      </div>

      <div className={s.card} role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${pack.key}`}>
        <ol className={s.steps} aria-label={pack.title} data-routine-compact>
          {pack.steps.map((st, i) => (
            <li key={i} className={s.step} data-status={st.status}>
              <span className={s.thumb} aria-hidden="true">
                {st.product?.imageUrl ? (
                  <Image src={st.product.imageUrl} alt="" fill sizes="56px" draggable={false} />
                ) : (
                  <Icon name="spa" size={22} />
                )}
                <span className={s.stepNo}>{toFaDigits(i + 1)}</span>
              </span>
              <span className={s.stepText}>
                <span className={s.stepLabel}>{st.label}</span>
                {st.product ? (
                  <Link href={st.product.href} className={s.name}>
                    {st.product.name}
                  </Link>
                ) : (
                  <span className={s.soon}>به‌زودی</span>
                )}
              </span>
              <span className={s.price}>
                {st.status === 'ok' && st.price !== null ? (
                  <>
                    <b className="tnum">{formatToman(st.price)}</b>
                    <span className={s.unit}>تومان</span>
                  </>
                ) : st.status === 'out' ? (
                  <span className={s.out}>ناموجود</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        {/* desktop (≥1024px): the same five steps as the shared product cards in the shared carousel */}
        <div className={s.desktop} data-routine-carousel>
          <Carousel key={pack.key} label={`مراحل ${pack.title}`}>
            {pack.steps.map((st, i) => (
              <div key={i} className={s.stepItem} data-status={st.status}>
                <span className={s.stepTag}>
                  <b>{toFaDigits(i + 1)}</b>
                  {st.label}
                </span>
                {st.product && st.status !== 'soon' ? (
                  <ProductCard
                    product={{
                      id: st.product.id,
                      href: st.product.href,
                      name: st.product.name,
                      brand: st.product.brand,
                      imageUrl: st.product.imageUrl,
                      priceToman: st.price ?? 0,
                      stock: st.status === 'out' ? 'out' : 'in',
                    }}
                  />
                ) : (
                  <div className={s.soonCard}>
                    <Icon name="spa" size={40} />
                    <b>به‌زودی</b>
                    <span>محصول این مرحله به‌زودی اضافه می‌شود.</span>
                  </div>
                )}
              </div>
            ))}
          </Carousel>
        </div>

        <aside className={s.summary} aria-label={`قیمت ${pack.title}`}>
          <div className={s.total}>
            {pack.available && pack.final !== null ? (
              <>
                <span className={s.totalLabel}>
                  قیمت پک ({toFaDigits(ok)} محصول)
                  {pack.saving > 0 && <span className={s.saving}>{toFaDigits(pack.saving)}٪ تخفیف</span>}
                </span>
                <span className={s.prices}>
                  {pack.final < pack.total && <del className="tnum">{formatToman(pack.total)}</del>}
                  <b className="tnum">{formatToman(pack.final)}</b>
                  <span className={s.unit}>تومان</span>
                </span>
              </>
            ) : (
              <span className={s.totalLabel}>فعلاً در دسترس نیست</span>
            )}
          </div>
          <div className={s.actions}>
            <AddPackButton
              collection={pack.collection}
              variant={pack.key}
              className={s.add}
              disabled={!pack.available}
              dataAttr="data-routine-add"
            />
            <Link href={pack.href} className={s.view}>
              مشاهده محصولات
              <Icon name="arrow_back" size={18} />
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
