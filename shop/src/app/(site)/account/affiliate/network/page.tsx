import type { Metadata } from 'next';
import Link from 'next/link';
import { toFaDigits } from '@/lib/format/number';
import { formatToman } from '@/lib/format/money';
import { maskedPhone, networkName } from '@/lib/affiliate/report';
import { requireUser } from '@/server/auth/guards';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';
import { Breadcrumb, EmptyState, Pagination } from '@/ui';
import s from '../../account.module.css';
import { NotAffiliate } from '../_ui/NotAffiliate';

export const metadata: Metadata = { title: 'افراد معرفی‌شده', robots: { index: false } };

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });
const href = (page: number) => `/account/affiliate/network${page > 1 ? `?page=${page}` : ''}`;

/**
 * The people the affiliate referred (one level only). Privacy: a first name, the last four digits of the number, the join date, the
 * number of paid orders and what the affiliate earned from them — nothing else. Each person opens their own page with their orders.
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
  const data = await affiliatePanelService.network(user, Number(sp.page) || 1).catch(() => null);
  return (
    <>
      <Breadcrumb items={crumbs} />
      <h1 className={s.title}>افراد معرفی‌شده</h1>
      {!data ? (
        <EmptyState icon="error" tone="danger" title="فهرست بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      ) : data.rows.length === 0 ? (
        <EmptyState icon="person" title="هنوز کسی را معرفی نکرده‌اید">
          لینک یا کد معرف خود را به اشتراک بگذارید.
        </EmptyState>
      ) : (
        <section className={`${s.card} ${s.wide}`} aria-label="افراد" data-network>
          <p className={s.muted}>{toFaDigits(data.total)} نفر · برای دیدن سفارش‌ها و پورسانت هر نفر روی او بزنید.</p>
          <ul className={s.rows}>
            {data.rows.map((r) => (
              <li key={r.token} data-network-row>
                <Link href={`/account/affiliate/network/${r.token}`} className={s.row} data-person-link>
                  <div className={s.rowMain}>
                    <b>{networkName(r.first_name)}</b>
                    <span className={s.muted}>
                      <span dir="ltr">{maskedPhone(r.phone_last4)}</span> · عضویت: {dateFa.format(r.joined_at)}
                    </span>
                  </div>
                  <span className={s.muted}>{toFaDigits(r.orders)} سفارش</span>
                  <span className={s.muted}>
                    پورسانت: <b className="tnum">{formatToman(r.commission)}</b> تومان
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && <Pagination page={data.page} totalPages={data.pages} hrefFor={href} />}
    </>
  );
}
