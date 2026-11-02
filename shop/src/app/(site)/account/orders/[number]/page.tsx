import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { canEditOrder, cancelPlanOf, refundAmountOf } from '@/lib/orders/cancel';
import { ORDER_STATUS_LABEL } from '@/lib/orders/filters';
import { trackingCode } from '@/lib/orders/payment-flow';
import { timelineOf } from '@/lib/orders/timeline';
import { orderPath, ordersPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { orderCancelService } from '@/server/services/order-cancel.service';
import { orderFlowService } from '@/server/services/order-flow.service';
import { orderPaymentService } from '@/server/services/order-payment.service';
import { orderService } from '@/server/services/order.service';
import { orderRepository } from '@/server/repositories/order.repository';
import { Alert, Badge, Breadcrumb } from '@/ui';
import s from '../../../checkout/checkout.module.css';
import a from '../../account.module.css';
import { CancelPanel } from './CancelPanel';
import { PayPanel } from './PayPanel';

const dateTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' });

export const metadata: Metadata = { title: 'سفارش', robots: { index: false, follow: false } };

/**
 * The order's page (only its owner; another user's number is a 404). It shows what the customer is charged: goods, the shipping
 * he pays, the total, the address and the delivery window — never what the shop pays Liateam. A pending order shows the way to pay.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { number } = await params;
  const sp = await searchParams;
  const user = await requireUser(orderPath(number));
  let order = await orderService.forUser(user.id, number);
  if (!order) notFound();
  // a paid order moves on (the bot's order, the placing, its progress): looking at it also carries it one step further
  if (!['pending_payment', 'sent', 'refunded', 'canceled'].includes(order.status)) {
    await orderFlowService.advance(order.id);
    order = (await orderService.forUser(user.id, number)) ?? order;
  }
  const options = order.status === 'pending_payment' ? await orderPaymentService.options(user.id) : null;
  const error = typeof sp.error === 'string' ? sp.error : '';
  const { items } = order;
  const events = await orderRepository.events(order.id).catch(() => []);
  const steps = timelineOf(events, order.created_at);
  const cancelRequested = events.some((e) => e.kind === 'cancel_requested');
  const plan = cancelPlanOf(order.status);
  const cancelOn = plan !== 'none' && (await orderCancelService.enabled());
  const tracking = trackingCode(order.tracking);
  return (
    <div className={s.page}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'سفارش‌ها', href: ordersPath() },
          { label: order.number },
        ]}
      />
      <div className={s.orderHead}>
        <h1 className={s.title}>ثبت سفارش</h1>
        <span className={s.orderNumber} data-order-number>
          شماره‌ی سفارش: <b className="tnum">{toFaDigits(order.number)}</b>
        </span>
        <Badge tone="neutral">{ORDER_STATUS_LABEL[order.status] ?? order.status}</Badge>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {order.status === 'pending_payment' && (
        <Alert tone="warning">
          سفارش شما ثبت شد و در انتظار پرداخت است؛ تا پرداخت، مبلغی از شما کم نمی‌شود.
        </Alert>
      )}
      {order.status === 'queued' && (
        <Alert tone="success">پرداخت شما ثبت شد. سفارش در صف ثبت است و به‌زودی پیگیری می‌شود.</Alert>
      )}
      {order.status === 'needs_review' && (
        <Alert tone="warning">
          سفارش شما پرداخت شده و در حال بررسی است (ممکن است قیمت یا موجودی کالایی تغییر کرده باشد). پشتیبانی
          با شما هماهنگ می‌کند؛ مبلغی خودکار برگردانده نمی‌شود.
        </Alert>
      )}
      {cancelRequested && ['placing', 'awaiting_payment'].includes(order.status) && (
        <Alert tone="warning">
          درخواست لغو ثبت شد و پس از تأیید اپراتور مبلغ به کیف پول برمی‌گردد.
        </Alert>
      )}
      {order.status === 'canceled' && (
        <Alert tone="danger">این سفارش لغو شده است. اگر مبلغی پرداخت شده بود، در کیف پول شما ثبت شده است.</Alert>
      )}
      {tracking && (
        <div className={a.track} data-order-tracking>
          کد رهگیری مرسوله: <span className="tnum" dir="ltr">{tracking}</span>
        </div>
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
            <dd className="tnum">
              {order.shipping_charged === 0 ? 'رایگان' : `${formatToman(order.shipping_charged)} تومان`}
            </dd>
          </div>
          <div className={s.total}>
            <dt>مبلغ قابل پرداخت</dt>
            <dd className="tnum" data-order-payable>
              {formatToman(order.total_payable)} تومان
            </dd>
          </div>
        </dl>
      </section>
      {cancelOn && !(plan === 'request' && cancelRequested) && (
        <CancelPanel
          number={order.number}
          plan={plan}
          refund={refundAmountOf(order.status, order.total_payable)}
          canEdit={canEditOrder(order.status)}
        />
      )}
      {options && <PayPanel number={order.number} total={order.total_payable} options={options} />}
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
      <section className={s.card} aria-label="روند سفارش" data-order-timeline>
        <h2 className={s.h2}>روند سفارش</h2>
        <ol className={a.timeline}>
          {steps.map((st) => (
            <li key={st.key} className={a.step} data-tone={st.tone} data-step data-final={st.final ? 'true' : undefined}>
              <b>{st.label}</b>
              <span className={a.muted}>{dateTime.format(st.at)}</span>
              {st.note !== undefined && (
                <span className={a.muted} data-step-note>
                  مبلغ {formatToman(st.note)} تومان به کیف پول شما برگشت داده شد
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
