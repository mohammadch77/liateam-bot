import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { parseCallbackQuery } from '@/lib/orders/payment-flow';
import { paymentCallbackPath, paymentSimulatorPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { orderRepository } from '@/server/repositories/order.repository';
import { paymentRepository } from '@/server/repositories/payment.repository';
import { Alert, Button, Container } from '@/ui';
import s from '../../checkout/checkout.module.css';

export const metadata: Metadata = { title: 'درگاه آزمایشی', robots: { index: false, follow: false } };

/**
 * The dev payment gateway's page (staging and development only: a 404 on the real site). The tester chooses paid, failed or
 * canceled and is sent back to the callback exactly as a real gateway would. It shows the order and the amount from the database.
 */
export default async function PaymentSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (getConfig().APP_ENV === 'production') notFound();
  const sp = await searchParams;
  const here = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  );
  const user = await requireUser(`${paymentSimulatorPath()}?${here}`);
  const { authority } = parseCallbackQuery(sp);
  const payment = authority ? await paymentRepository.findByAuthority(authority) : null;
  const order = payment ? await orderRepository.findById(payment.order_id) : null;
  if (!authority || !payment || !order || order.user_id !== user.id || payment.gateway !== 'dev') notFound();

  const back = (status: 'OK' | 'NOK', sim: string) =>
    `${paymentCallbackPath()}?Authority=${authority}&Status=${status}&sim=${sim}`;
  return (
    <Container className={s.page}>
      <h1 className={s.title}>درگاه پرداخت آزمایشی</h1>
      <Alert tone="warning">این درگاه فقط برای آزمایش است و هیچ پولی جابه‌جا نمی‌شود.</Alert>
      <section className={s.card}>
        <dl className={s.rows}>
          <div>
            <dt>شماره‌ی سفارش</dt>
            <dd className="tnum">{toFaDigits(order.number)}</dd>
          </div>
          <div className={s.total}>
            <dt>مبلغ</dt>
            <dd className="tnum" data-sim-amount>
              {formatToman(payment.amount)} تومان
            </dd>
          </div>
        </dl>
        <Button href={back('OK', 'success')} prefetch={false} size="lg" block data-sim="success">
          پرداخت موفق
        </Button>
        <Button
          href={back('OK', 'failed')}
          prefetch={false}
          size="lg"
          block
          variant="outline"
          data-sim="failed"
        >
          پرداخت ناموفق
        </Button>
        <Button
          href={back('NOK', 'canceled')}
          prefetch={false}
          size="lg"
          block
          variant="outline"
          data-sim="canceled"
        >
          انصراف از پرداخت
        </Button>
      </section>
    </Container>
  );
}
