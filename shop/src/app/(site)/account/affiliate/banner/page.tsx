import type { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { requireUser } from '@/server/auth/guards';
import { qrSvg } from '@/server/export/qr';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';
import { Breadcrumb } from '@/ui';
import s from '../../account.module.css';
import { PrintButton, PrintStyles } from '../../_ui/PrintButton';
import { NotAffiliate } from '../_ui/NotAffiliate';
import b from './banner.module.css';

export const metadata: Metadata = { title: 'بنر چاپی', robots: { index: false } };

/**
 * A printable A5 banner for a pharmacy or a shop: the brand's name, a short line, the QR of the affiliate's own link (large, with its
 * quiet zone) and the referral code. The page is real text in the site's font and RTL; «ذخیره به‌صورت PDF» is the browser's print.
 */
export default async function BannerPage() {
  const user = await requireUser('/account/affiliate/banner');
  const crumbs = [
    { label: 'خانه', href: '/' },
    { label: 'حساب کاربری', href: '/account' },
    { label: 'همکاری در فروش', href: '/account/affiliate' },
    { label: 'بنر چاپی' },
  ];
  if (!isAffiliateUser(user))
    return (
      <>
        <Breadcrumb items={crumbs} />
        <NotAffiliate />
      </>
    );
  const { link, code } = await affiliatePanelService.qrLink(user);
  const svg = await qrSvg(link);
  const brand = getConfig().BRAND_NAME;
  return (
    <>
      <PrintStyles />
      <style>{'@media print{@page{size:A5 portrait;margin:0}}'}</style>
      <Breadcrumb items={crumbs} />
      <h1 className={s.title}>بنر چاپی (A5)</h1>
      <div className={s.btnRow} data-no-print>
        <PrintButton label="چاپ یا ذخیره به‌صورت PDF" />
      </div>
      <article className={b.sheet} data-banner aria-label="بنر چاپی">
        <p className={b.brand}>{brand}</p>
        <h2 className={b.headline}>خرید اصل، با اسکن یک QR</h2>
        <p className={b.sub}>دوربین گوشی را روی کد بگیرید و در {brand} ثبت‌نام کنید.</p>
        <div className={b.qr} dangerouslySetInnerHTML={{ __html: svg }} data-banner-qr />
        <p className={b.codeLabel}>کد معرف</p>
        <p className={b.code} dir="ltr" data-banner-code>
          {code}
        </p>
      </article>
    </>
  );
}
