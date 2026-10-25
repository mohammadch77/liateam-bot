'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState, type KeyboardEvent } from 'react';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { Icon } from '@/ui';
import s from './skin-routine.module.css';

/** Only what the section shows (no ids beyond the pack key, no purchase price). */
export type RoutinePack = {
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
    product: { name: string; href: string; brand: string | null; imageUrl: string | null } | null;
  }>;
};

/** The cart arrives in phase 2: the same placeholder as the product page's add-to-cart button. */
const SOON = 'به‌زودی فعال می‌شود';

/**
 * Home «روتین پوستی» (Homepage.dc.html): one tab per skin type (a segmented control that scrolls on phones) and one
 * compact card — the five steps as short rows (small image, step, name, price; a «به‌زودی» step dimmed), the pack
 * price (the items' sum unless the admin gave the pack a discount) and two actions: «افزودن پک به سبد خرید» (adds
 * every available item; a placeholder like the product page's button until the cart exists) and «مشاهده محصولات».
 * Every pack is in the page, so switching is instant; rows have a fixed height (no layout shift).
 */
export function SkinRoutine({ title, packs }: { title: string; packs: RoutinePack[] }) {
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
    <section className={s.section} aria-labelledby="routine-title" data-routine={pack.key}>
      <div className={s.head}>
        <h2 id="routine-title" className={s.title}>
          {title} شما
        </h2>
        <p className={s.sub}>
          نوع پوستتان را انتخاب کنید؛ {toFaDigits(pack.steps.length)} قدم به ترتیب مصرف.
        </p>
      </div>

      <div className={s.tabs} role="tablist" aria-label="نوع پوست" onKeyDown={onKey}>
        {packs.map((p, i) => (
          <button
            key={p.key}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`routine-tab-${p.key}`}
            aria-controls="routine-panel"
            aria-selected={p.key === pack.key}
            tabIndex={p.key === pack.key ? 0 : -1}
            className={s.tab}
            onClick={() => setKey(p.key)}
          >
            {p.variantTitle}
          </button>
        ))}
      </div>

      <div className={s.card} role="tabpanel" id="routine-panel" aria-labelledby={`routine-tab-${pack.key}`}>
        <ol className={s.steps} aria-label={pack.title}>
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
            <button
              type="button"
              className={s.add}
              aria-disabled="true"
              title={SOON}
              aria-label={`افزودن پک به سبد خرید (${SOON})`}
              data-routine-add
            >
              <Icon name="add_shopping_cart" size={20} />
              افزودن پک به سبد خرید
            </button>
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
