import type { Metadata } from 'next';
import { toFaDigits } from '@/lib/format/number';
import { maskedPhone, networkName } from '@/lib/affiliate/report';
import { requireUser } from '@/server/auth/guards';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';
import { Breadcrumb, EmptyState, Pagination } from '@/ui';
import s from '../../account.module.css';
import { NotAffiliate } from '../_ui/NotAffiliate';

export const metadata: Metadata = { title: 'افراد معرفی‌شده', robots: { index: false } };

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });
const href = (level: number | null, page: number) => {
  const q = new URLSearchParams();
  if (level) q.set('level', String(level));
  if (page > 1) q.set('page', String(page));
  return `/account/affiliate/network${q.size ? `?${q}` : ''}`;
};

/**
 * The people the affiliate brought, by level 1-5. Privacy: a first name, the last four digits of the number, the join date and the number
 * of paid orders — nothing else of the person or of their orders.
 */
export default async function NetworkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser('/account/affiliate/network');
  const sp = await searchParams;
  const crumbs = [
    { label: 'خانه', href: '/' },
    { label: 'حساب کاربری', href: '/account' },
    { label: 'همکاری در فروش', href: '/account/affiliate' },
    { label: 'افراد معرفی‌شده' },
  ];
  if (!isAffiliateUser(user))
    return (
      <>
        <Breadcrumb items={crumbs} />
        <NotAffiliate />
      </>
    );
  const level = Number(sp.level) || null;
  const data = await affiliatePanelService.network(user, level, Number(sp.page) || 1).catch(() => null);
  return (
    <>
      <Breadcrumb items={crumbs} />
      <h1 className={s.title}>افراد معرفی‌شده</h1>
      {!data ? (
        <EmptyState icon="error" tone="danger" title="فهرست بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      ) : (
        <>
          <nav className={s.chips} aria-label="فیلتر سطح" data-level-filters>
            <a href={href(null, 1)} className={s.chip} aria-current={data.level === null}>
              همه ({toFaDigits(data.counts.reduce((a, b) => a + b, 0))})
            </a>
            {data.counts.map((n, i) => (
              <a key={i} href={href(i + 1, 1)} className={s.chip} aria-current={data.level === i + 1} data-level={i + 1}>
                سطح {toFaDigits(i + 1)} ({toFaDigits(n)})
              </a>
            ))}
          </nav>
          {data.rows.length === 0 ? (
            <EmptyState icon="person" title="هنوز کسی از این سطح معرفی نشده است">
              لینک معرفی خود را به اشتراک بگذارید.
            </EmptyState>
          ) : (
            <section className={`${s.card} ${s.wide}`} aria-label="افراد">
              <ul className={s.rows}>
                {data.rows.map((r, i) => (
                  <li key={i} className={s.row} data-network-row data-level={r.level}>
                    <div className={s.rowMain}>
                      <b>{networkName(r.first_name)}</b>
                      <span className={s.muted}>
                        <span dir="ltr">{maskedPhone(r.phone_last4)}</span> · عضویت: {dateFa.format(r.joined_at)}
                      </span>
                    </div>
                    <span className={s.muted}>سطح {toFaDigits(r.level)}</span>
                    <span className={s.muted}>{toFaDigits(r.orders)} سفارش</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Pagination page={data.page} totalPages={data.pages} hrefFor={(p) => href(data.level, p)} />
        </>
      )}
    </>
  );
}
