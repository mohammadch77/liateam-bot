import type { Metadata } from 'next';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { requireUser } from '@/server/auth/guards';
import {
  affiliatePanelService,
  commissionFilterOf,
  isAffiliateUser,
} from '@/server/services/affiliate-panel.service';
import { Badge, Breadcrumb, Button, EmptyState, Pagination } from '@/ui';
import s from '../../account.module.css';
import { PrintButton, PrintStyles } from '../../_ui/PrintButton';
import { NotAffiliate } from '../_ui/NotAffiliate';

export const metadata: Metadata = { title: 'پورسانت‌ها', robots: { index: false } };

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });
const STATUS: Record<string, { label: string; tone: 'neutral' | 'inStock' | 'outOfStock' }> = {
  pending: { label: 'در انتظار', tone: 'neutral' },
  approved: { label: 'تأیید شد', tone: 'inStock' },
  paid: { label: 'تأیید شد و واریز شد', tone: 'inStock' },
  cancelled: { label: 'لغو شد', tone: 'outOfStock' },
};
const FILTERS = [
  { key: '', label: 'همه' },
  { key: 'pending', label: 'در انتظار' },
  { key: 'paid', label: 'واریزشده' },
  { key: 'cancelled', label: 'لغوشده' },
];

/** the same filters, as a query string (for the pages and the CSV link) */
const qs = (f: { status: string | null; from: string | null; to: string | null }, page = 1) => {
  const q = new URLSearchParams();
  if (f.status) q.set('status', f.status);
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (page > 1) q.set('page', String(page));
  return q.toString();
};

/**
 * The affiliate's commissions with their status, level, the order's goods total it was computed on, the rule's percent or amount, the
 * dates (release date while pending), filters, pages and the page's sum; the last twelve Persian months as light bars; and a CSV of the
 * same data. Only the signed-in affiliate's own rows.
 */
export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser('/account/affiliate/commissions');
  const sp = await searchParams;
  const crumbs = [
    { label: 'خانه', href: '/' },
    { label: 'حساب کاربری', href: '/account' },
    { label: 'همکاری در فروش', href: '/account/affiliate' },
    { label: 'پورسانت‌ها' },
  ];
  if (!isAffiliateUser(user))
    return (
      <>
        <Breadcrumb items={crumbs} />
        <NotAffiliate />
      </>
    );
  const f = commissionFilterOf(sp);
  const [data, months] = await Promise.all([
    affiliatePanelService.commissions(user, f, Number(sp.page) || 1).catch(() => null),
    affiliatePanelService.monthly(user).catch(() => null),
  ]);
  const max = Math.max(1, ...(months ?? []).map((m) => m.total));
  return (
    <>
      <PrintStyles />
      <Breadcrumb items={crumbs} />
      <h1 className={s.title}>پورسانت‌ها</h1>
      {months && (
        <section className={`${s.card} ${s.wide}`} aria-label="گزارش ماهانه" data-monthly>
          <h2 className={s.h2}>پورسانت ۱۲ ماه اخیر</h2>
          <ul className={s.rows}>
            {months.map((m) => (
              <li key={m.key} className={s.row} data-month={m.key}>
                <span style={{ minWidth: 110 }}>{m.label}</span>
                <span
                  aria-hidden="true"
                  style={{
                    flex: '1 1 80px',
                    height: 10,
                    borderRadius: 5,
                    background: 'var(--color-blush-2)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${Math.round((m.total / max) * 100)}%`,
                      background: 'var(--color-primary)',
                    }}
                  />
                </span>
                <span className={s.amount} data-month-total>
                  {formatToman(m.total)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form method="get" className={s.chips} aria-label="فیلتر پورسانت‌ها" data-commission-filters>
        <select name="status" defaultValue={f.status ?? ''} className={s.chip} aria-label="وضعیت">
          {FILTERS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={f.from ?? ''} className={s.chip} aria-label="از تاریخ" dir="ltr" />
        <input type="date" name="to" defaultValue={f.to ?? ''} className={s.chip} aria-label="تا تاریخ" dir="ltr" />
        <Button type="submit">
          اعمال فیلتر
        </Button>
        <Button href={`/account/affiliate/export?${qs(f)}`} variant="outline" prefetch={false} data-csv>
          خروجی CSV
        </Button>
        <Button href={`/account/affiliate/export?${qs(f)}&format=xlsx`} variant="outline" prefetch={false} data-xlsx>
          خروجی Excel
        </Button>
        <PrintButton />
      </form>
      {!data ? (
        <EmptyState icon="error" tone="danger" title="فهرست پورسانت‌ها بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      ) : data.rows.length === 0 ? (
        <EmptyState icon="account_balance_wallet" title="پورسانتی با این فیلتر نیست" />
      ) : (
        <section className={`${s.card} ${s.wide}`} aria-label="پورسانت‌ها">
          <ul className={s.rows}>
            {data.rows.map((c) => (
              <li key={c.id} className={s.row} data-commission={c.status}>
                <div className={s.rowMain}>
                  <b className="tnum" data-commission-amount>
                    {formatToman(c.amount)} تومان
                  </b>
                  <span className={s.muted}>
                    مبلغ سفارش پایه: {formatToman(c.base_amount)} تومان
                    {c.rule_kind === 'percent' && c.rule_value !== null && ` · ${toFaDigits(c.rule_value)}٪`}
                    {c.rule_kind === 'fixed' && c.rule_value !== null && ` · مبلغ ثابت ${formatToman(c.rule_value)}`}
                  </span>
                  <span className={s.muted}>
                    {dateFa.format(c.created_at)}
                    {c.status === 'pending' && c.release_at && ` · آزادسازی: ${dateFa.format(c.release_at)}`}
                    {c.status === 'pending' && !c.release_at && ' · بعد از ارسال سفارش و پایان مهلت، به کیف پول شما واریز می‌شود.'}
                    {c.paid_at && ` · واریز: ${dateFa.format(c.paid_at)}`}
                  </span>
                </div>
                <Badge tone={STATUS[c.status]?.tone ?? 'neutral'}>{STATUS[c.status]?.label ?? c.status}</Badge>
              </li>
            ))}
          </ul>
          <p className={s.muted} data-page-sum>
            جمع این صفحه (بدون لغوشده‌ها): <b className="tnum">{formatToman(data.pageSum)}</b> تومان · جمع کل این فیلتر:{' '}
            <b className="tnum">{formatToman(data.filterSum)}</b> تومان
          </p>
        </section>
      )}
      {data && <Pagination page={data.page} totalPages={data.pages} hrefFor={(p) => `/account/affiliate/commissions?${qs(f, p)}`} />}
    </>
  );
}
