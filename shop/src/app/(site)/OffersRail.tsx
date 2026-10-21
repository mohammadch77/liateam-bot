import Link from 'next/link';
import type { ProductView } from '@/server/services/catalog.service';
import { Icon, ProductCard } from '@/ui';
import { Countdown } from './Countdown';
import s from './offers-rail.module.css';

/**
 * Home «تخفیفات ویژه» (Homepage.dc.html «پیشنهاد شگفت‌انگیز»): a rail of up to 8 discounted products, the
 * campaign's countdown when one runs, «مشاهده همه» → /offers. With nothing discounted the same frame says «به‌زودی»,
 * so the section keeps its place and height.
 */
export function OffersRail({
  items,
  campaign,
}: {
  items: ProductView[];
  campaign: { title: string; endsAt: string } | null;
}) {
  return (
    <section className={s.band} aria-labelledby="offers-title" data-offers={items.length ? 'on' : 'soon'}>
      <div className={s.head}>
        <div className={s.titleBox}>
          <span className={s.bolt} aria-hidden="true">
            <Icon name="bolt" size={24} />
          </span>
          <div>
            <h2 id="offers-title" className={s.title}>
              تخفیفات ویژه
            </h2>
            <p className={s.sub}>
              {campaign ? campaign.title : 'تخفیف‌های منتخب، با قیمت قبل و بعد از تخفیف'}
            </p>
          </div>
        </div>
        {campaign && items.length > 0 && (
          <Countdown endsAt={campaign.endsAt} label={`زمان باقی‌مانده تا پایان ${campaign.title}`} />
        )}
        <Link href="/offers" className={s.all}>
          مشاهده همه
          <Icon name="arrow_back" size={18} />
        </Link>
      </div>
      {items.length > 0 ? (
        <ul className={s.rail} aria-label="محصولات تخفیف‌دار">
          {items.map((p) => (
            <li key={p.id} className={s.slot}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.soon}>
          <Icon name="bolt" size={34} />
          <b>به‌زودی</b>
          <span>تخفیف‌های ویژه به‌زودی همین‌جا می‌آیند.</span>
        </div>
      )}
    </section>
  );
}
