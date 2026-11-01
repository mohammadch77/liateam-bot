import type { PayOptions } from '@/lib/orders/payment-flow';
import { Button } from '@/ui';
import s from '../../../checkout/checkout.module.css';
import { PayMethods } from '../../../_pay/PayMethods';
import { payOrderFormAction } from './actions';

/** The way to pay (or pay again) an order that is waiting for payment. The amount is not sent: the server has it. */
export function PayPanel({
  number,
  total,
  options,
  retry = false,
}: {
  number: string;
  total: number;
  options: PayOptions;
  retry?: boolean;
}) {
  return (
    <form action={payOrderFormAction} className={s.card} data-pay-panel>
      <input type="hidden" name="number" value={number} />
      <PayMethods options={options} total={total} />
      <Button
        type="submit"
        size="lg"
        block
        icon="check"
        data-pay-submit
        disabled={!options.online && options.walletBalance < total}
      >
        {retry ? 'تلاش دوباره برای پرداخت' : 'پرداخت'}
      </Button>
    </form>
  );
}
