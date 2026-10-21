'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
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

/**
 * Home «روتین پوستی» (Homepage.dc.html): skin-type chips, the five steps of the chosen pack, the items' total struck
 * through, the pack price and the saving, «مشاهده محصولات» → the pack page (the cart comes in phase 2). Every pack
 * is already in the page, so switching skin type is instant; the step boxes have a fixed height (no layout shift).
 */
export function SkinRoutine({ title, packs }: { title: string; packs: RoutinePack[] }) {
  const [key, setKey] = useState(packs[0]?.key);
  const pack = packs.find((p) => p.key === key) ?? packs[0];
  if (!pack) return null;
  return (
    <section className={s.section} aria-labelledby="routine-title" data-routine={pack.key}>
      <div className={s.head}>
        <div>
          <h2 id="routine-title" className={s.title}>
            {title} شما
          </h2>
          <p className={s.sub}>
            {toFaDigits(pack.steps.length)} قدم، به ترتیب مصرف؛ نوع پوستتان را انتخاب کنید.
          </p>
        </div>
        <div className={s.chips} role="radiogroup" aria-label="نوع پوست">
          {packs.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={p.key === pack.key}
              className={s.chip}
              onClick={() => setKey(p.key)}
            >
              {p.variantTitle}
            </button>
          ))}
        </div>
      </div>

      <div className={s.body}>
        <ol className={s.steps} aria-label={pack.title}>
          {pack.steps.map((st, i) => (
            <li key={i} className={s.step} data-status={st.status}>
              <span className={s.stepNo}>
                {toFaDigits(i + 1)}. {st.label}
              </span>
              {st.product ? (
                <Link href={st.product.href} className={s.product}>
                  <span className={s.thumb}>
                    {st.product.imageUrl ? (
                      <Image src={st.product.imageUrl} alt="" fill sizes="96px" />
                    ) : (
                      <Icon name="spa" size={30} />
                    )}
                  </span>
                  {st.product.brand && <span className={s.brand}>{st.product.brand}</span>}
                  <span className={s.name}>{st.product.name}</span>
                  <span className={s.price}>
                    {st.status === 'ok' && st.price !== null ? (
                      <>
                        <b className="tnum">{formatToman(st.price)}</b> تومان
                      </>
                    ) : (
                      <span className={s.out}>ناموجود</span>
                    )}
                  </span>
                </Link>
              ) : (
                <span className={s.soon}>
                  <Icon name="spa" size={28} />
                  به‌زودی
                </span>
              )}
            </li>
          ))}
        </ol>

        <aside className={s.summary} aria-label={`قیمت ${pack.title}`}>
          <span className={s.sumLabel}>{pack.title}</span>
          {pack.available && pack.final !== null ? (
            <>
              <b className={s.sumLead}>
                همه‌ی {toFaDigits(pack.steps.filter((x) => x.status === 'ok').length)} محصول
                {pack.saving > 0 && <> با {toFaDigits(pack.saving)}٪ صرفه‌جویی</>}
              </b>
              <div className={s.prices}>
                {pack.final < pack.total && <del className="tnum">{formatToman(pack.total)} تومان</del>}
                <b className={`${s.final} tnum`}>
                  {formatToman(pack.final)} <span>تومان</span>
                </b>
              </div>
            </>
          ) : (
            <b className={s.sumLead}>فعلاً در دسترس نیست</b>
          )}
          <Link href={pack.href} className={s.cta}>
            مشاهده محصولات
            <Icon name="arrow_back" size={18} />
          </Link>
        </aside>
      </div>
    </section>
  );
}
