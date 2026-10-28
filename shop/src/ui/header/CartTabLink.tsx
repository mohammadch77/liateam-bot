'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCart } from '../cart/CartContext';

/**
 * The cart tab of the phone tab bar: a tap opens the mini-cart as a bottom sheet (the page stays where it is); without
 * JavaScript, or with a modifier key, it is the plain link to the cart page.
 */
export function CartTabLink({
  href,
  className,
  current,
  children,
}: {
  href: string;
  className: string | undefined;
  current: boolean;
  children: ReactNode;
}) {
  const cart = useCart();
  return (
    <Link
      href={href}
      className={className}
      aria-current={current ? 'page' : undefined}
      aria-haspopup={cart ? 'dialog' : undefined}
      aria-expanded={cart ? cart.miniOpen : undefined}
      data-cart-tab
      onClick={(e) => {
        if (cart && window.matchMedia('(max-width: 1023px)').matches && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          cart.toggleMini();
        }
      }}
    >
      {children}
    </Link>
  );
}
