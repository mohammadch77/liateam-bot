'use client';

import { createContext, useContext } from 'react';

/**
 * What the design-system components know about the cart: a number for the badge, an «add» function and a switch for the
 * mini-cart. The app's CartProvider (app/(site)/_cart) fills it with the real cart; without a provider (the style guide)
 * the components fall back to their static look. No data access here.
 */
export type CartApi = {
  units: number;
  /** adds `quantity` units (default 1); resolves with a Persian message when it could not */
  add: (productId: number, quantity?: number) => Promise<{ ok: boolean; message?: string }>;
  /** a pack was added (the units now in the cart); the number follows */
  setUnits: (units: number) => void;
  /** tells the customer something, politely (the «added» toast) */
  notify: (text: string, ok: boolean) => void;
  /** the product is being added now / was just added */
  state: (productId: number) => 'idle' | 'loading' | 'done';
  miniOpen: boolean;
  toggleMini: () => void;
};

export const CartContext = createContext<CartApi | null>(null);

export const useCart = (): CartApi | null => useContext(CartContext);
