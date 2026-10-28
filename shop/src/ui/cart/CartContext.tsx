'use client';

import { createContext, useContext } from 'react';
import type { CartSnapshot } from '@/lib/cart/snapshot';

/**
 * What the design-system components know about the cart. ONE store behind it (the app's CartProvider): the badge, the
 * mini-cart and the cart page all read `snapshot` / `units` from here and change the cart only through `add` and
 * `setQuantity`, so they cannot disagree. Without a provider (the style guide) the components keep their static look.
 * No data access in this file.
 */
export type CartResult = { ok: boolean; message?: string };

export type CartApi = {
  /** units in the cart (the badge) */
  units: number;
  /** the cart as every view shows it right now (an optimistic change included); null until a view has loaded it */
  snapshot: CartSnapshot | null;
  /** adds `quantity` units (default 1); resolves with a Persian message when it could not */
  add: (productId: number, quantity?: number) => Promise<CartResult>;
  /**
   * Sets a line's quantity (0 takes it out). The views change at once (optimistic) and go back, with a message, when the
   * server refuses. `base` = the snapshot the caller shows when the provider has none yet (the cart page's own).
   */
  setQuantity: (productId: number, quantity: number, base?: CartSnapshot | null) => Promise<CartResult>;
  /** takes a newer snapshot from the server (a pack was added) */
  adopt: (snapshot: CartSnapshot) => void;
  /** tells the customer something, politely (the toast) */
  notify: (text: string, ok: boolean) => void;
  /** the product is being added now / was just added */
  state: (productId: number) => 'idle' | 'loading' | 'done';
  /** a change of this line is on its way to the server */
  busy: (productId: number) => boolean;
  miniOpen: boolean;
  openMini: () => void;
  closeMini: () => void;
  toggleMini: () => void;
};

export const CartContext = createContext<CartApi | null>(null);

export const useCart = (): CartApi | null => useContext(CartContext);
