import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { ORDER_STATUS_LABEL } from '@/lib/orders/filters';
import { COMMISSION_STATUS_LABEL, maskOrderNumber, maskedPhone, networkName, ruleLabel } from '@/lib/affiliate/report';
import { requireUser } from '@/server/auth/guards';
import { affiliatePanelService, isAffiliateUser } from '@/server/services/affiliate-panel.service';
import { Badge, Breadcrumb, Button, EmptyState } from '@/ui';
import s from '../../../account.module.css';
import { PrintButton, PrintStyles } from '../../../_ui/PrintButton';
import { NotAffiliate } from '../../_ui/NotAffiliate';

export const metadata: Metadata = { title: 'سفارش‌های فرد معرفی‌شده', robots: { index: false } };

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

/**
 * One referred person: their paid orders with the commission each gave this affiliate. Only the affiliate who referred them can open
 * it (anyone else, or a token that is not theirs, gets a 404). Privacy: the order's goods total and the commission only — no item
 * name, no address, no whole number. Excel from the server; PDF through the browser's print of this page.
 */
export default async function PersonPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/account/affiliate/network/${token}`);
  const crumbs = [
    { label: 'خانه', href: '/' },
    { label: 'حساب کاربری', href: '/account' },
    { label: 'همکاری در فروش', href: '/account/affiliate' },
    { label: 'افراد معرفی‌شده', href: '/account/affiliate/network' },
    { label: 'سفارش‌ها' },
  ];
  if (!isAffiliateUser(user))
    return (
      <>
        <Breadcrumb items={crumbs} />
        <NotAffiliate />
      </>
    );
  const d = await affiliatePanelService.person(user, token).catch((e: unknown) => {
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'NOT_FOUND') return null;
    throw e;
  });
  if (!d) notFound();
  return (
    <>
      <PrintStyles />
      <Breadcrumb items={crumbs} />
      <h1 className={s.title}>
        {networkName(d.person.first_name)} · <span dir="ltr">{maskedPhone(d.person.phone_last4)}</span>
      </h1>
      <p className={s.muted}>عضویت: {dateFa.format(d.person.joined_at)}</p>
      <section className={s.stats} aria-label="جمع" data-person-totals>
        <div className={s.stat}>
          <span>تعداد سفارش‌های پرداخت‌شده</span>
          <b data-total-orders>{toFaDigits(d.totals.orders)}</b>
        </div>
        <div className={s.stat}>
          <span>جمع مبلغ سفارش‌ها</span>
          <b data-total-base>{formatToman(d.totals.base)} تومان</b>
        </div>
        <div className={s.stat}>
          <span>جمع پورسانت (بدون لغوشده‌ها)</span>
          <b data-total-commission>{formatToman(d.totals.commission)} تومان</b>
        </div>
      </section>
      <div className={s.btnRow} data-no-print>
        <Button href={`/account/affiliate/network/${token}/export`} variant="outline" prefetch={false} data-xlsx>
          خروجی Excel
        </Button>
        <PrintButton />
      </div>
      {d.orders.length === 0 ? (
        <EmptyState icon="shopping_bag" title="این فرد هنوز سفارش پرداخت‌شده‌ای ندارد" />
      ) : (
        <section className={`${s.card} ${s.wide}`} aria-label="سفارش‌ها">
          <ul className={s.rows}>
            {d.orders.map((o) => (
              <li key={o.order_number} className={s.row} data-person-order>
                <div className={s.rowMain}>
                  <b className="tnum" data-order-code>
                    {maskOrderNumber(o.order_number)}
                  </b>
                  <span className={s.muted}>
                    {dateFa.format(o.paid_at)} · مبلغ سفارش: <span className="tnum">{formatToman(o.base_amount ?? o.items_total)}</span>{' '}
                    تومان · {ORDER_STATUS_LABEL[o.order_status as keyof typeof ORDER_STATUS_LABEL] ?? o.order_status}
                  </span>
                  <span className={s.muted}>
                    {o.commission === null
                      ? 'پورسانتی برای این سفارش ثبت نشده است.'
                      : `پورسانت ${ruleLabel(o.rule_kind, o.rule_value)}: ${formatToman(o.commission)} تومان`}
                  </span>
                </div>
                {o.commission_status && (
                  <Badge tone={o.commission_status === 'cancelled' ? 'outOfStock' : 'neutral'}>
                    {COMMISSION_STATUS_LABEL[o.commission_status] ?? o.commission_status}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
