import type { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { walletPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';
import { affiliateProgramService } from '@/server/services/affiliate-program.service';
import { affiliateService } from '@/server/services/affiliate.service';
import { Breadcrumb, Button, EmptyState } from '@/ui';
import { AffiliateApply, AffiliateIntro } from '../../affiliate/AffiliateSections';
import s from '../account.module.css';
import { AffiliateMaintenanceCard, AffiliateTiersCard } from './_ui/AffiliateProgressCards';
import { BusinessCard } from './_ui/BusinessCard';
import { CopyButton } from './_ui/CopyButton';

export const metadata: Metadata = { title: 'همکاری در فروش', robots: { index: false } };

/** The affiliate's dashboard: eligibility/maintenance/tier progress bars, business card + PDF, referral code & commission summary. */
export default async function AffiliateDashboard() {
  const user = await requireUser('/account/affiliate');
  const crumbs = [
    { label: 'خانه', href: '/' },
    { label: 'حساب کاربری', href: '/account' },
    { label: 'همکاری در فروش' },
  ];
  if (!isAffiliateUser(user)) {
    const [status, eligibility] = await Promise.all([
      affiliateService.statusFor(user),
      affiliateProgramService.eligibilityFor(user.id).catch(() => null),
    ]);
    return (
      <>
        <Breadcrumb items={crumbs} />
        <div data-affiliate-join={status.kind}>
          <AffiliateIntro />
        </div>
        <AffiliateApply
          user={user}
          status={status}
          source="account"
          here="/account/affiliate"
          eligibility={eligibility}
        />
      </>
    );
  }
  const o = await affiliatePanelService.overview(user).catch(() => null);
  const brand = getConfig().BRAND_NAME;

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
          {/* ── 1. Monthly Personal Maintenance Quota & Progressive Sales Tier Steps ── */}
          {o.progress && (
            <>
              <AffiliateMaintenanceCard maintenance={o.progress.maintenance} />
              <AffiliateTiersCard sales={o.progress.sales} />
            </>
          )}

          {/* ── 2. Referral Code & Personal Link ── */}
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
              هر کسی که با این لینک برای اولین بار ثبت‌نام کند، به شما نسبت داده می‌شود و بعد از آن تغییر
              نمی‌کند.
            </p>
          </section>

          {/* ── 3. Commission Summary KPIs ── */}
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
              <span>افراد معرفی‌شده</span>
              <b data-stat-network>{toFaDigits(o.network)} نفر</b>
            </div>
            <div className={s.stat}>
              <span>موجودی قابل برداشت</span>
              <b data-stat-withdrawable>{formatToman(o.withdrawable)} تومان</b>
            </div>
          </section>

          {/* ── 4. Luxury Affiliate Business Card (QR + 1-Click PDF Download) ── */}
          <section className={`${s.card} ${s.wide}`} aria-labelledby="aff-uses" data-affiliate-uses>
            <h2 id="aff-uses" className={s.h2}>
              کارت ویزیت دیجیتال و QR کد اختصاصی شما
            </h2>
            <p className={s.muted}>
              این کارت ویزیت اختصاصی را به صورت فایل PDF دریافت کنید، چاپ کنید یا در شبکه‌های اجتماعی برای معرفی
              فروشگاه خود منتشر نمایید.
            </p>
            <BusinessCard
              brandName={brand}
              sellerName={user.fullName ?? ''}
              phone={user.phone}
              code={o.code}
              link={o.link}
              tierTitle={o.progress?.sales.currentTier?.title ?? null}
            />
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
