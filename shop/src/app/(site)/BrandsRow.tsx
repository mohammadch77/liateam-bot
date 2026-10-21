'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/ui';
import s from './home-sections.module.css';

export type BrandTile = { code: number; name: string; href: string; logoUrl: string | null };

/** One logo; the brand's name as text when there is no logo or it does not load. */
function Logo({ b }: { b: BrandTile }) {
  const [broken, setBroken] = useState(false);
  if (!b.logoUrl || broken) return <span className={s.brandName}>{b.name}</span>;
  // our own route (/api/brand-logo/<code>, already small SVG / PNG), never the supplier's host
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={b.logoUrl}
      alt={b.name}
      className={s.brandLogo}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * Home «برندها» (Homepage.dc.html): a row of brand logos, each to its brand page (its products, as on Liateam),
 * «همه‌ی برندها» → /brands. Scrolls sideways on phones.
 */
export function BrandsRow({ brands }: { brands: BrandTile[] }) {
  return (
    <section className={s.section} aria-labelledby="brands-title" data-home-section="brands">
      <div className={s.head}>
        <h2 id="brands-title" className={s.title}>
          برندها
        </h2>
        <Link href="/brands" className={s.more}>
          همه‌ی برندها
          <Icon name="arrow_back" size={18} />
        </Link>
      </div>
      <ul className={s.brands}>
        {brands.map((b) => (
          <li key={b.code}>
            <Link href={b.href} className={s.brand} aria-label={b.name} data-brand={b.code}>
              <Logo b={b} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
