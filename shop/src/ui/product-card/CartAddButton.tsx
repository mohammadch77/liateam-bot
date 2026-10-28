'use client';

import { useCart } from '../cart/CartContext';
import { AddToCartButton } from './AddToCartButton';

/**
 * The product card's add-to-cart control: the design's three states (idle · adding · added) driven by the cart of the
 * page. Without a cart (the style guide) it stays the static button.
 */
export function CartAddButton({ productId, name }: { productId: number; name?: string }) {
  const cart = useCart();
  if (!cart) return <AddToCartButton state="idle" />;
  return (
    <AddToCartButton
      state={cart.state(productId)}
      productName={name}
      onClick={() => {
        if (cart.state(productId) === 'loading') return;
        void cart.add(productId);
      }}
    />
  );
}
