'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Icon, ProductCard, Skeleton, type ProductCardData } from '@/ui';
import s from './home-sections.module.css';

export type BestsellerCard = ProductCardData & { id: number };
type Tab = { key: string; label: string; href: string };

/**
 * Home «پرفروش‌ترین‌ها» (Homepage.dc.html): tabs (همه / مراقبت پوست / آرایشی / عطر و بدن / مو و دهان), up to 10
 * cards, «مشاهده همه» → the shop filtered to the tab's categories. The first tab comes with the page; another tab is
 * loaded when first opened (/api/bestsellers), showing skeleton cards of the same size meanwhile (no layout shift).
 */
export function Bestsellers({ tabs, initial }: { tabs: Tab[]; initial: BestsellerCard[] }) {
  const first = tabs[0]!.key;
  const [active, setActive] = useState(first);
  const [loaded, setLoaded] = useState<Record<string, BestsellerCard[]>>({ [first]: initial });
  const [failed, setFailed] = useState(false);
  const pending = useRef(new Set<string>());

  const open = (key: string) => {
    setActive(key);
    setFailed(false);
    if (loaded[key] || pending.current.has(key)) return;
    pending.current.add(key);
    fetch(`/api/bestsellers?tab=${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items: BestsellerCard[] }) => setLoaded((x) => ({ ...x, [key]: d.items })))
      .catch(() => setFailed(true))
      .finally(() => pending.current.delete(key));
  };

  const tab = tabs.find((t) => t.key === active)!;
  const items = loaded[active];
  return (
    <section className={s.section} aria-labelledby="bestsellers-title" data-bestsellers={active}>
      <div className={s.head}>
        <h2 id="bestsellers-title" className={s.title}>
          پرفروش‌ترین‌ها
        </h2>
        <Link href={tab.href} className={s.more}>
          مشاهده همه
          <Icon name="arrow_back" size={18} />
        </Link>
      </div>
      <div className={s.tabs} role="tablist" aria-label="دسته‌های پرفروش‌ترین‌ها">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            className={s.tab}
            onClick={() => open(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={s.grid} role="tabpanel" aria-label={tab.label} aria-busy={!items && !failed}>
        {items ? (
          items.length ? (
            items.map((p) => <ProductCard key={p.id} product={p} />)
          ) : (
            <p className={s.empty}>فعلاً محصولی در این دسته موجود نیست.</p>
          )
        ) : failed ? (
          <p className={s.empty}>بارگذاری نشد؛ دوباره روی تب بزنید.</p>
        ) : (
          Array.from({ length: 10 }, (_, i) => (
            <div key={i} className={s.skeletonCard} data-skeleton>
              <Skeleton height="100%" />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
