'use client';

import { useEffect } from 'react';
import { useFavorites } from '../favorites/FavoritesContext';
import { FavoriteButton } from './FavoriteButton';
import s from './ProductCard.module.css';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';

/**
 * The heart of a product: on or off from the customer's list. A guest's click goes to the sign-in and comes back to the same page.
 * Without a favourites store (the style guide) it stays the static heart.
 */
export function FavoriteToggle({ productId, name }: { productId: number; name?: string }) {
  const fav = useFavorites();
  const load = fav?.load;
  useEffect(() => {
    load?.();
  }, [load]);
  if (!fav) return <FavoriteButton />;
  const on = fav.has(productId);
  const label = `${on ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}${name ? `: ${name}` : ''}`;
  return (
    <button
      type="button"
      className={cx(s.iconButton, s.favButton, on && s.favOn)}
      aria-pressed={on}
      aria-label={label}
      disabled={fav.busy(productId)}
      onClick={() => fav.toggle(productId)}
      data-favorite={on ? 'on' : 'off'}
      data-product={productId}
    >
      <Icon name="favorite" filled={on} size={21} />
    </button>
  );
}
