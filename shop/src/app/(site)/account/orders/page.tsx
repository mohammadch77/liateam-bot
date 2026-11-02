import type { Metadata } from 'next';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { ORDER_FILTERS, ORDER_STATUS_LABEL, orderFilterOf, type OrderFilterKey } from '@/lib/orders/filters';
import { orderPath, ordersPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { accountService } from '@/server/services/account.service';
import { Badge, Breadcrumb, Button, EmptyState, Pagination } from '@/ui';
import s from '../account.module.css';

export const metadata: Metadata = { title: 'سفارش‌های من', robots: { index: false } };

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });
const hrefFor = (filter: OrderFilterKey, page: number) => {
  const q = new URLSearchParams();
  if (filter !== 'all') q.set('status', filter);
  if (page > 1) q.set('page', String(page));
  const qs = q.toString();
  return qs ? `${ordersPath()}?${qs}` : ordersPath();
};

/** The customer's orders: a status filter and pages. Only this user's rows are ever read. */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser(ordersPath());
  const filter = orderFilterOf(sp.status);
  const data = await accountService.orders(user.id, filter, Number(sp.page) || 1).catch(() => null);

  return (
    <>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'سفارش‌ها' }]} />
      <h1 className={s.title}>سفارش‌های من</h1>
      <nav className={s.chips} aria-label="فیلتر وضعیت" data-order-filters>
        {(Object.keys(ORDER_FILTERS) as OrderFilterKey[]).map((k) => (
          <a key={k} href={hrefFor(k, 1)} className={s.chip} aria-current={k === filter} data-filter={k}>
            {ORDER_FILTERS[k].label}
          </a>
        ))}
      </nav>
      {!data ? (
        <EmptyState icon="error" tone="danger" title="فهرست سفارش‌ها بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon="shopping_bag"
          title={filter === 'all' ? 'هنوز سفارشی ثبت نکرده‌اید' : 'سفارشی با این وضعیت نیست'}
          action={filter === 'all' ? <Button href="/shop">رفتن به فروشگاه</Button> : undefined}
        />
      ) : (
        <section className={`${s.card} ${s.wide}`} aria-label="فهرست سفارش‌ها">
          <ul className={s.rows}>
            {data.rows.map((o) => (
              <li key={o.id} className={s.row} data-order-row={o.number}>
                <div className={s.rowMain}>
                  <b>{toFaDigits(o.number)}</b>
                  <span className={s.muted}>{dateFa.format(o.created_at)}</span>
                </div>
                <span className={s.amount}>{formatToman(o.total_payable)} تومان</span>
                <Badge tone="neutral">{ORDER_STATUS_LABEL[o.status]}</Badge>
                <Button href={orderPath(o.number)} variant="outline" size="sm">
                  جزئیات
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && <Pagination page={data.page} totalPages={data.pages} hrefFor={(p) => hrefFor(filter, p)} />}
    </>
  );
}
