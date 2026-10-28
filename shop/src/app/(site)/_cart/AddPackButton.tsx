'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@/ui';
import { useCart } from '@/ui/cart/CartContext';
import { addPackToCartAction } from './actions';

/**
 * «افزودن پک به سبد خرید»: adds every available item of the pack. The server reads the items from the database; the
 * browser sends only the collection and the pack key.
 */
export function AddPackButton({
  collection,
  variant,
  className,
  label = 'افزودن پک به سبد خرید',
  disabled = false,
  dataAttr,
}: {
  collection: string;
  variant: string;
  className?: string | undefined;
  label?: string;
  disabled?: boolean;
  dataAttr?: string;
}) {
  const cart = useCart();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || pending || !cart}
      aria-busy={pending}
      {...(dataAttr ? { [dataAttr]: '' } : {})}
      onClick={() =>
        start(async () => {
          const r = await addPackToCartAction(collection, variant);
          if (!r.ok) return cart?.notify(r.error, false);
          cart?.setUnits(r.data.units);
          cart?.notify(r.data.skipped ? `${r.data.added} کالا افزوده شد؛ ${r.data.skipped} کالا قابل افزودن نبود.` : 'همه‌ی اقلام پک به سبد افزوده شد.', true);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        })
      }
    >
      <Icon name={done ? 'check' : 'add_shopping_cart'} size={20} />
      {pending ? 'در حال افزودن…' : done ? 'افزوده شد' : label}
    </button>
  );
}
