'use client';

import Link from 'next/link';
import { formatNumber } from '@/lib/format/number';
import { useCart } from '../cart/CartContext';
import { Icon } from '../icon/Icon';
import s from './Header.module.css';

/**
 * The cart icon with the number of units. The number is the server's at first and then follows the cart of the page
 * (it changes when something is added); on a wide screen a click opens the mini-cart, on a phone it goes to the cart page.
 */
export function CartLink({ href, count: initial }: { href: string; count: number }) {
  const cart = useCart();
  const count = cart ? cart.units : initial;
  return (
    <Link
      href={href}
      className={s.iconLink}
      aria-label={count > 0 ? `سبد خرید، ${formatNumber(count)} کالا` : 'سبد خرید'}
      aria-haspopup={cart ? 'dialog' : undefined}
      aria-expanded={cart ? cart.miniOpen : undefined}
      data-header-action="cart"
      data-cart-count={count}
      onClick={(e) => {
        if (cart && window.matchMedia('(min-width: 1024px)').matches && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          cart.toggleMini();
        }
      }}
    >
      <Icon name="shopping_bag" size={24} />
      {count > 0 && (
        <span className={s.count} aria-hidden="true">
          {formatNumber(count)}
        </span>
      )}
    </Link>
  );
}
