'use client';

import { createContext, useContext } from 'react';

/**
 * What the favourite hearts know. ONE store behind them (the app's FavoritesProvider): it asks the server once, after the page has
 * loaded and only when a heart is on the page, which products the signed-in customer has; a click flips the heart at once and tells the
 * server. Without a provider (the style guide) the hearts keep their static look. No data access in this file.
 */
export type FavoritesApi = {
  /** the product is on the customer's list */
  has: (productId: number) => boolean;
  /** a change of this product is on its way */
  busy: (productId: number) => boolean;
  /** asks the server for the list (once; every heart calls it when it appears) */
  load: () => void;
  /** flips the heart; a guest is sent to the sign-in and brought back to this page */
  toggle: (productId: number) => void;
};

export const FavoritesContext = createContext<FavoritesApi | null>(null);
export const useFavorites = (): FavoritesApi | null => useContext(FavoritesContext);
