'use server';

import { redirect } from 'next/navigation';
import { orderPath } from '@/lib/urls';
import { runAction } from '@/server/http/action';
import { orderPaymentService } from '@/server/services/order-payment.service';

/**
 * «پرداخت» / «تلاش دوباره» of a pending order. The form sends only the order number and the method; the amount is the
 * order's own total in the database. On success the customer goes to the gateway (or, paid from the wallet, to the order).
 */
export async function payOrderFormAction(form: FormData): Promise<void> {
  const number = String(form.get('number') ?? '');
  const method = form.get('method') === 'wallet' ? 'wallet' : 'gateway';
  const r = await runAction('order.pay', async () => orderPaymentService.start(number, method));
  // redirect() throws a control-flow signal, so it stays outside runAction's try/catch
  if (!r.ok) redirect(`${orderPath(number)}?error=${encodeURIComponent(r.error)}`);
  redirect(r.data.kind === 'redirect' ? r.data.url : `${orderPath(r.data.number)}?paid=1`);
}
