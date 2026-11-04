import type { Metadata } from 'next';
import Image from 'next/image';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { walletPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';
import { affiliateService } from '@/server/services/affiliate.service';
import { AffiliateApply, AffiliateIntro } from '../../affiliate/AffiliateSections';
import { Breadcrumb, Button, EmptyState } from '@/ui';
import s from '../account.module.css';
import { CopyButton } from './_ui/CopyButton';

export const metadata: Metadata = { title: 'همکاری در فروش', robots: { index: false } };

/** The affiliate's dashboard: the referral code and link, the commission summary, the network size and what can be withdrawn. */
export default async function AffiliateDashboard() {
  const user = await requireUser('/account/affiliate');
  const crumbs = [{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'همکاری در فروش' }];
  if (!isAffiliateUser(user)) {
    // the introduction and, under it, the application / its state: one address for a customer, a pending applicant and an affiliate
    const status = await affiliateService.statusFor(user);
    return (
      <>
        <Breadcrumb items={crumbs} />
        <div data-affiliate-join={status.kind}>
          <AffiliateIntro />
        </div>
        <AffiliateApply user={user} status={status} source="account" here="/account/affiliate" />
      </>
    );
  }
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
              <span>افراد معرفی‌شده</span>
              <b data-stat-network>{toFaDigits(o.network)} نفر</b>
            </div>
            <div className={s.stat}>
              <span>موجودی قابل برداشت</span>
              <b data-stat-withdrawable>{formatToman(o.withdrawable)} تومان</b>
            </div>
          </section>
          <section className={`${s.card} ${s.wide}`} aria-labelledby="aff-uses" data-affiliate-uses>
            <h2 id="aff-uses" className={s.h2}>
              کد معرف کجا به کار می‌آید؟
            </h2>
            <ol className={s.rows} style={{ paddingInlineStart: 20, gap: 8 }}>
              <li>
                <b>لینک:</b> مشتری با کلیک روی لینک ثبت‌نام می‌کند و به شما نسبت داده می‌شود.
              </li>
              <li>
                <b>کد:</b> مشتری جدید می‌تواند کد را هنگام ثبت‌نام یا در تسویه‌ی اولین خرید وارد کند.
              </li>
              <li>
                <b>QR:</b> برای بنر و پوستر در داروخانه و مغازه‌ها.
              </li>
            </ol>
            <div className={s.row} style={{ alignItems: 'center' }}>
              <Image src="/account/affiliate/qr" alt="QR کد لینک معرفی شما" width={168} height={168} unoptimized data-qr />
              <div className={s.btnRow}>
                <Button href="/account/affiliate/qr?f=svg&download=1" variant="outline" prefetch={false} data-qr-svg>
                  دانلود QR (SVG)
                </Button>
                <Button href="/account/affiliate/qr?f=png&download=1" variant="outline" prefetch={false} data-qr-png>
                  دانلود QR (PNG)
                </Button>
                <Button href="/account/affiliate/banner" variant="outline" data-qr-banner>
                  بنر چاپی (A5)
                </Button>
              </div>
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
