import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { orderPath, ordersPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { orderService } from '@/server/services/order.service';
import { Alert, Badge, Breadcrumb, Container } from '@/ui';
import s from '../../../checkout/checkout.module.css';

export const metadata: Metadata = { title: 'سفارش', robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'در انتظار پرداخت',
  queued: 'پرداخت‌شده، در صف ثبت',
  placing: 'در حال ثبت',
  awaiting_payment: 'در حال ثبت نزد تأمین‌کننده',
  supplier_paid: 'در حال آماده‌سازی',
  sent: 'ارسال شد',
  needs_review: 'در حال بررسی',
  refunded: 'بازگشت وجه شد',
  canceled: 'لغو شد',
};

/**
 * The order's page (only its owner; another user's number is a 404). It shows what the customer is charged: goods, the shipping
 * he pays, the total, the address and the delivery window — never what the shop pays Liateam. Payment arrives in the next step.
 */
export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const user = await requireUser(orderPath(number));
  const order = await orderService.forUser(user.id, number);
  if (!order) notFound();
  const { items } = order;
  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'سفارش‌ها', href: ordersPath() }, { label: order.number }]} />
      <div className={s.orderHead}>
        <h1 className={s.title}>ثبت سفارش</h1>
        <span className={s.orderNumber} data-order-number>
          شماره‌ی سفارش: <b className="tnum">{toFaDigits(order.number)}</b>
        </span>
        <Badge tone="neutral">{STATUS_LABEL[order.status] ?? order.status}</Badge>
      </div>
      {order.status === 'pending_payment' && (
        <Alert tone="warning">سفارش شما ثبت شد. پرداخت در مرحله‌ی بعد فعال می‌شود؛ تا آن زمان مبلغی از شما کم نشده است.</Alert>
      )}
      <section className={s.card} aria-label="اقلام سفارش">
        <table className={s.table}>
          <thead>
            <tr>
              <th>کالا</th>
              <th>تعداد</th>
              <th>قیمت واحد</th>
              <th>جمع</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} data-order-item={i.product_id}>
                <td>{i.name}</td>
                <td className="tnum">{toFaDigits(i.quantity)}</td>
                <td className="tnum">{formatToman(i.unit_price)}</td>
                <td className="tnum">{formatToman(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className={s.rows}>
          <div>
            <dt>جمع کالاها</dt>
            <dd className="tnum">{formatToman(order.items_total)} تومان</dd>
          </div>
          {order.discount_total > 0 && (
            <div className={s.off}>
              <dt>تخفیف شما</dt>
              <dd className="tnum">{formatToman(order.discount_total)} تومان</dd>
            </div>
          )}
          <div>
            <dt>هزینه‌ی ارسال (پست)</dt>
            <dd className="tnum">{order.shipping_charged === 0 ? 'رایگان' : `${formatToman(order.shipping_charged)} تومان`}</dd>
          </div>
          <div className={s.total}>
            <dt>مبلغ قابل پرداخت</dt>
            <dd className="tnum" data-order-payable>
              {formatToman(order.total_payable)} تومان
            </dd>
          </div>
        </dl>
      </section>
      <section className={s.card} aria-label="آدرس تحویل">
        <h2 className={s.h2}>آدرس تحویل</h2>
        <p>
          {order.recipient_name} · <span className="tnum">{toFaDigits(order.recipient_phone)}</span>
        </p>
        <p className={s.muted}>
          {order.province}، {order.city}، {order.line}، پلاک {toFaDigits(order.plate)}
          {order.unit ? `، واحد ${toFaDigits(order.unit)}` : ''} · کد پستی {toFaDigits(order.postal_code)}
        </p>
        <p className={s.delivery} data-order-delivery>
          {order.delivery_eta_min_days !== null && order.delivery_eta_max_days !== null
            ? `زمان تحویل: حدود ${toFaDigits(order.delivery_eta_min_days)}${order.delivery_eta_max_days !== order.delivery_eta_min_days ? ` تا ${toFaDigits(order.delivery_eta_max_days)}` : ''} روز پس از پرداخت`
            : 'زمان تحویل پس از پرداخت اعلام می‌شود.'}
        </p>
      </section>
    </Container>
  );
}
