import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { ORDER_STATUS_LABEL } from '@/lib/orders/filters';
import { ADMIN_SORTS, ADMIN_STATUS_FILTERS, type AdminStatusFilter } from '@/lib/orders/operator';
import { requireRole } from '@/server/auth/guards';
import { orderAdminService } from '@/server/services/order-admin.service';
import { Badge, Breadcrumb, Button, Container, EmptyState, Pagination } from '@/ui';
import s from '../../account/account.module.css';
import a from '../affiliates/admin-affiliates.module.css';

export const metadata: Metadata = { title: 'سفارش‌ها', robots: { index: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });
const TAB_ORDER: AdminStatusFilter[] = [
  'all',
  'action',
  'needs_review',
  'queued',
  'awaiting_payment',
  'supplier_paid',
  'sent',
  'canceled',
  'pending_payment',
];

/** All orders for the operator: status chips, search (order number / mobile), date range, sort, pages. Support sees it too. */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('support', '/admin/orders');
  const sp = await searchParams;
  const v = await orderAdminService.list({
    status: sp.status,
    q: sp.q,
    from: sp.from,
    to: sp.to,
    sort: sp.sort,
    page: sp.page,
  });
  const qs = (over: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | number | null> = {
      status: v.status === 'all' ? null : v.status,
      q: v.q || null,
      from: v.from,
      to: v.to,
      sort: v.sort === 'newest' ? null : v.sort,
      page: null,
      ...over,
    };
    for (const [k, val] of Object.entries(cur)) if (val !== null && val !== '') p.set(k, String(val));
    const t = p.toString();
    return `/admin/orders${t ? `?${t}` : ''}`;
  };

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'سفارش‌ها' }]} />
      <section className={s.card} aria-labelledby="orders-title" style={{ maxWidth: 'none' }}>
        <h1 id="orders-title" className={s.title}>
          سفارش‌ها
        </h1>
        <nav aria-label="وضعیت سفارش" className={a.tabs}>
          {TAB_ORDER.map((k) => (
            <Link
              key={k}
              href={qs({ status: k === 'all' ? null : k, page: null })}
              className={a.tab}
              aria-current={k === v.status ? 'page' : undefined}
              data-tab={k}
            >
              {ADMIN_STATUS_FILTERS[k].label}
              {k === 'action' && ` (${toFaDigits(v.actionCount)})`}
            </Link>
          ))}
        </nav>
        <form method="get" className={s.chips} aria-label="جست‌وجو و فیلتر" data-orders-filter>
          {v.status !== 'all' && <input type="hidden" name="status" value={v.status} />}
          <input
            name="q"
            defaultValue={v.q}
            placeholder="شمارهٔ سفارش یا موبایل"
            aria-label="شمارهٔ سفارش یا موبایل"
            className={s.chip}
            dir="ltr"
            maxLength={20}
          />
          <input type="date" name="from" defaultValue={v.from ?? ''} className={s.chip} aria-label="از تاریخ" dir="ltr" />
          <input type="date" name="to" defaultValue={v.to ?? ''} className={s.chip} aria-label="تا تاریخ" dir="ltr" />
          <select name="sort" defaultValue={v.sort} className={s.chip} aria-label="مرتب‌سازی">
            {Object.entries(ADMIN_SORTS).map(([k, x]) => (
              <option key={k} value={k}>
                {x.label}
              </option>
            ))}
          </select>
          <Button type="submit">اعمال</Button>
        </form>
        {v.rows.length === 0 ? (
          <EmptyState icon="search_off" title="سفارشی با این فیلتر نیست." />
        ) : (
          <ul className={a.list} data-orders-list>
            {v.rows.map((o) => (
              <li key={o.id} className={a.item} data-order-row={o.number} data-needs-action={o.needs_action}>
                <div className={a.head}>
                  <Link href={`/admin/orders/${o.number}`} className="tnum" data-order-link>
                    <b>{o.number}</b>
                  </Link>
                  <Badge tone={o.status === 'canceled' || o.status === 'refunded' ? 'outOfStock' : 'neutral'}>
                    {ORDER_STATUS_LABEL[o.status]}
                  </Badge>
                  {o.needs_action && (
                    <Badge tone="limited">{o.cancel_requested ? 'درخواست لغو' : 'نیازمند اقدام'}</Badge>
                  )}
                  <b className="tnum">{formatToman(o.total_payable)} تومان</b>
                </div>
                <div className={a.muted}>
                  {o.customer_name ? `${o.customer_name} · ` : ''}
                  <span dir="ltr">{toFaDigits(o.phone_masked)}</span> · {timeFa.format(o.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className={s.muted} data-orders-count>
          {toFaDigits(v.total)} سفارش
        </p>
        <Pagination page={v.page} totalPages={v.pages} hrefFor={(p) => qs({ page: p > 1 ? p : null })} />
      </section>
    </Container>
  );
}
