'use client';

import { formatNumber } from '@/lib/format/number';
import { useCart } from '../cart/CartContext';
import s from './BottomNav.module.css';

/** The number on the cart tab: the server's at first, then the cart of the page. */
export function BottomNavCount({ initial }: { initial: number }) {
  const cart = useCart();
  const count = cart ? cart.units : initial;
  if (count <= 0) return null;
  return (
    <>
      <span className={s.count} aria-hidden="true" data-cart-count={count}>
        {formatNumber(count)}
      </span>
      <span className="sr-only">{formatNumber(count)} کالا</span>
    </>
  );
}
