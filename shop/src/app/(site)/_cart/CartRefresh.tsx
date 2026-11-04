'use client';

import { useEffect } from 'react';
import { useCart } from '@/ui/cart/CartContext';

/** Mounted on the pages that follow a purchase: the header badge and the mini-cart read the cart again (the order's items are out of it). */
export function CartRefresh() {
  const cart = useCart();
  const refresh = cart?.refresh;
  useEffect(() => {
    refresh?.();
  }, [refresh]);
  return null;
}
