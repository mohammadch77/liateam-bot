import type { Metadata } from 'next';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { walletPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';
import { Breadcrumb, Button, EmptyState } from '@/ui';
import s from '../account.module.css';
import { CopyButton } from './_ui/CopyButton';
import { NotAffiliate } from './_ui/NotAffiliate';

export const metadata: Metadata = { title: 'همکاری در فروش', robots: { index: false } };

/** The affiliate's dashboard: the referral code and link, the commission summary, the network size and what can be withdrawn. */
export default async function AffiliateDashboard() {
  const user = await requireUser('/account/affiliate');
  const crumbs = [{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'همکاری در فروش' }];
  if (!isAffiliateUser(user))
    return (
      <>
        <Breadcrumb items={crumbs} />
        <NotAffiliate />
      </>
    );
  const o = await affiliatePanelService.overview(user).catch(() => null);
  return (
    <>
      <Breadcrumb items={crumbs} />
      <h1 className={s.title}>همکاری در فروش</h1>
      {!o ? (
        <EmptyState icon="error" tone="danger" title="خلاصه‌ی همکاری بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      ) : (
        <>
          <section className={`${s.card} ${s.wide}`} aria-label="کد و لینک معرفی" data-affiliate-code>
            <h2 className={s.h2}>کد و لینک معرفی شما</h2>
            <div className={s.row}>
              <div className={s.rowMain}>
                <span className={s.muted}>کد معرف</span>
                <b dir="ltr" data-code>
                  {o.code}
                </b>
              </div>
              <CopyButton text={o.code} label="کپی کد" />
            </div>
            <div className={s.row}>
              <div className={s.rowMain} style={{ minWidth: 0 }}>
                <span className={s.muted}>لینک معرفی</span>
                <b dir="ltr" data-link style={{ overflowWrap: 'anywhere' }}>
                  {o.link}
                </b>
              </div>
              <CopyButton text={o.link} label="کپی لینک" />
            </div>
            <p className={s.muted}>
              هر کسی که با این لینک برای اولین بار ثبت‌نام کند، به شما نسبت داده می‌شود و بعد از آن تغییر نمی‌کند.
            </p>
          </section>
          <section className={s.stats} aria-label="خلاصه‌ی پورسانت" data-affiliate-summary>
            <div className={s.stat}>
              <span>پورسانت در انتظار</span>
              <b data-stat-pending>{formatToman(o.totals.pending)} تومان</b>
            </div>
            <div className={s.stat}>
              <span>واریزشده به کیف پول</span>
              <b data-stat-paid>{formatToman(o.totals.paid)} تومان</b>
            </div>
            <div className={s.stat}>
              <span>مجموع پورسانت</span>
              <b data-stat-total>{formatToman(o.totals.total)} تومان</b>
            </div>
            <div className={s.stat}>
              <span>معرفی‌شده‌ها (همه‌ی سطح‌ها)</span>
              <b data-stat-network>{toFaDigits(o.network.reduce((a, b) => a + b, 0))} نفر</b>
            </div>
            <div className={s.stat}>
              <span>موجودی قابل برداشت</span>
              <b data-stat-withdrawable>{formatToman(o.withdrawable)} تومان</b>
            </div>
          </section>
          <div className={s.btnRow}>
            <Button href="/account/affiliate/commissions">پورسانت‌ها و گزارش</Button>
            <Button href="/account/affiliate/network" variant="outline">
              افراد معرفی‌شده
            </Button>
            <Button href={walletPath()} variant="outline">
              کیف پول
            </Button>
          </div>
        </>
      )}
    </>
  );
}
