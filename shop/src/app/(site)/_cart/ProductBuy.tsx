'use client';

import { useState } from 'react';
import { formatNumber } from '@/lib/format/number';
import { cartPath } from '@/lib/urls';
import { Button, Icon } from '@/ui';
import { useCart } from '@/ui/cart/CartContext';
import s from './cart.module.css';

/**
 * The product page's buy block: a quantity (never above the stock, at most 50) and «افزودن به سبد». The price is not
 * here: the server computes it again when the cart is shown. `stickyBar` is the compact copy in the bottom bar on phones.
 */
export function ProductBuy({
  productId,
  maxQuantity,
  compact = false,
}: {
  productId: number;
  /** the most one cart may hold of this product (stock, ≤ 50) */
  maxQuantity: number;
  compact?: boolean;
}) {
  const cart = useCart();
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const state = cart?.state(productId) ?? 'idle';
  const max = Math.max(1, maxQuantity);

  const add = async () => {
    if (!cart) return;
    setError(null);
    const r = await cart.add(productId, qty);
    if (!r.ok) setError(r.message ?? 'افزودن انجام نشد.');
  };

  const button = (
    <Button
      size={compact ? 'md' : 'lg'}
      block={!compact}
      icon={state === 'done' ? 'check' : 'add_shopping_cart'}
      loading={state === 'loading'}
      loadingText="در حال افزودن"
      onClick={add}
      disabled={!cart}
      tabIndex={compact ? -1 : undefined}
      data-product-buy={compact ? 'sticky' : 'main'}
    >
      {state === 'done' ? 'افزوده شد' : 'افزودن به سبد'}
    </Button>
  );
  if (compact) return button;
  return (
    <div className={s.buy}>
      <div className={s.buyRow}>
        <div className={s.stepper} role="group" aria-label="تعداد">
          <button type="button" className={s.stepBtn} aria-label="کم کردن" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>
            <Icon name="remove" size={20} />
          </button>
          <span className={`${s.stepValue} tnum`} aria-live="polite" data-product-qty>
            {formatNumber(qty)}
          </span>
          <button type="button" className={s.stepBtn} aria-label="زیاد کردن" disabled={qty >= max} onClick={() => setQty(qty + 1)}>
            <Icon name="add" size={20} />
          </button>
        </div>
        {button}
      </div>
      {qty >= max && max < 50 && <span className={s.buyNote}>بیشتر از موجودی انبار قابل سفارش نیست.</span>}
      {error && (
        <span className={s.buyError} role="alert">
          {error}
        </span>
      )}
      <a href={cartPath()} className={s.buyNote}>
        مشاهده سبد خرید
      </a>
    </div>
  );
}
