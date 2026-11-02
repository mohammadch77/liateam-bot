import type { Metadata } from 'next';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { orderPath, ordersPath, paymentCallbackPath, walletPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { orderPaymentService } from '@/server/services/order-payment.service';
import { orderService } from '@/server/services/order.service';
import { Alert, Breadcrumb, Button, Container } from '@/ui';
import s from '../../checkout/checkout.module.css';
import { PayPanel } from '../../account/orders/[number]/PayPanel';

export const metadata: Metadata = { title: 'نتیجه‌ی پرداخت', robots: { index: false, follow: false } };

/**
 * Where the payment gateway sends the customer back. Only the authority and the status are read from the address; the amount
 * and the order are the ones saved in the database. The page is safe to refresh or open twice: the same return shows the same
 * result and changes nothing again. A cancelled or failed payment leaves the order waiting, with a button to try again.
 */
export default async function PaymentCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const here = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  );
  const user = await requireUser(`${paymentCallbackPath()}?${here}`);
  const result = await orderPaymentService.handleCallback(user, sp);
  const order = result.orderNumber ? await orderService.forUser(user.id, result.orderNumber) : null;
  const topup = result.topup ?? null;
  const retry =
    order && order.status === 'pending_payment' && result.kind !== 'paid'
      ? await orderPaymentService.options(user.id)
      : null;
  const tone =
    result.kind === 'paid'
      ? 'success'
      : result.kind === 'unknown' || result.kind === 'failed'
        ? 'danger'
        : 'warning';

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'سفارش‌ها', href: ordersPath() },
          { label: 'نتیجه‌ی پرداخت' },
        ]}
      />
      <h1 className={s.title}>نتیجه‌ی پرداخت</h1>
      <div data-callback-result={result.kind} data-callback-repeat={result.repeat ? 'true' : 'false'}>
        <Alert tone={tone}>{result.message}</Alert>
      </div>
      {topup && (
        <section className={s.card} aria-label="شارژ کیف پول" data-topup-result>
          <dl className={s.rows}>
            <div className={s.total}>
              <dt>مبلغ شارژ</dt>
              <dd className="tnum">{formatToman(topup.amount)} تومان</dd>
            </div>
          </dl>
          <Button href={walletPath()} variant={result.kind === 'paid' ? 'primary' : 'outline'} data-view-wallet>
            {result.kind === 'paid' ? 'مشاهده‌ی کیف پول' : 'بازگشت به کیف پول'}
          </Button>
        </section>
      )}
      {order && (
        <section className={s.card} aria-label="سفارش">
          <dl className={s.rows}>
            <div>
              <dt>شماره‌ی سفارش</dt>
              <dd className="tnum" data-order-number>
                {toFaDigits(order.number)}
              </dd>
            </div>
            <div className={s.total}>
              <dt>مبلغ سفارش</dt>
              <dd className="tnum">{formatToman(order.total_payable)} تومان</dd>
            </div>
          </dl>
          <Button
            href={orderPath(order.number)}
            variant={result.kind === 'paid' ? 'primary' : 'outline'}
            data-view-order
          >
            مشاهده‌ی سفارش
          </Button>
        </section>
      )}
      {order && retry && <PayPanel number={order.number} total={order.total_payable} options={retry} retry />}
      {!order && !topup && (
        <Button href={ordersPath()} variant="outline">
          سفارش‌های من
        </Button>
      )}
    </Container>
  );
}
