'use client';

import { useState } from 'react';
import { formatToman } from '@/lib/format/money';
import { defaultMethod, methodUsable, type PayMethodId, type PayOptions } from '@/lib/orders/payment-flow';
import s from '../checkout/checkout.module.css';

/**
 * «روش پرداخت»: online (the bank gateway) or the wallet. Works inside a form (the radios are named `method`) and reports the
 * choice to a parent that needs it (the checkout button). What is usable comes from the server; the server checks again.
 */
export function PayMethods({
  options,
  total,
  onChange,
}: {
  options: PayOptions;
  /** toman, or null while it is not known yet (before the live check) */
  total: number | null;
  onChange?: (method: PayMethodId, usable: boolean) => void;
}) {
  const [method, setMethod] = useState<PayMethodId>(() => defaultMethod(options, total));
  const pick = (m: PayMethodId) => {
    setMethod(m);
    onChange?.(m, methodUsable(m, options, total));
  };
  const online = methodUsable('gateway', options, total);
  const wallet = methodUsable('wallet', options, total);
  return (
    <fieldset className={s.payMethods} data-pay-methods>
      <legend>روش پرداخت</legend>
      <label className={s.payOption} aria-disabled={!online} data-pay-option="gateway">
        <input
          type="radio"
          name="method"
          value="gateway"
          checked={method === 'gateway'}
          disabled={!online}
          onChange={() => pick('gateway')}
        />
        <span>
          پرداخت آنلاین (درگاه بانکی)
          {!online && (
            <span className={s.payHint} data-pay-unavailable>
              پرداخت آنلاین فعلاً در دسترس نیست.
            </span>
          )}
        </span>
      </label>
      {(options.walletBalance > 0 || !online) && (
        <label className={s.payOption} aria-disabled={!wallet} data-pay-option="wallet">
          <input
            type="radio"
            name="method"
            value="wallet"
            checked={method === 'wallet'}
            disabled={!wallet}
            onChange={() => pick('wallet')}
          />
          <span>
            کیف پول
            <span className={s.payHint}>
              موجودی: <b className="tnum">{formatToman(options.walletBalance)}</b> تومان
              {!wallet && ' · برای این سفارش کافی نیست'}
            </span>
          </span>
        </label>
      )}
    </fieldset>
  );
}
