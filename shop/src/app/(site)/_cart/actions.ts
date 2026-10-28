'use server';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { runAction, type ActionResult } from '@/server/http/action';
import { cartService, type CartChange } from '@/server/services/cart.service';
import { packService } from '@/server/services/pack.service';

/**
 * Cart actions (Server Actions: same-origin checked, rate limited in the service). The browser sends product codes and
 * quantities only — never a price, never a cart id: the owner is the signed-in user or the guest cookie.
 */
const id = z.number().int().positive();
const qty = z.number().int().min(0).max(50);
const bad = () => new AppError('INVALID_DATA');

export type MiniCart = {
  units: number;
  itemsTotal: number;
  items: Array<{ productId: number; name: string; href: string; imageUrl: string | null; quantity: number; unitPrice: number; lineTotal: number }>;
  more: number;
};

export async function addToCartAction(productId: number, quantity = 1): Promise<ActionResult<CartChange>> {
  return runAction('cart.add', async () => {
    const p = id.safeParse(productId);
    const q = z.number().int().min(1).max(50).safeParse(quantity);
    if (!p.success || !q.success) throw bad();
    return cartService.add(p.data, q.data);
  });
}

/** Adds every available item of a pack (the products come from the database, not from the browser). */
export async function addPackToCartAction(collection: string, variant: string) {
  return runAction('cart.add_pack', async () => {
    const found = await packService.pack(String(collection).slice(0, 80), String(variant).slice(0, 80));
    if (!found || !found.pack.available) throw new AppError('INVALID_DATA', { message: 'این پک فعلاً در دسترس نیست.' });
    const ids = found.pack.steps.flatMap((s) => (s.status === 'ok' && s.product ? [s.product.id] : []));
    return cartService.addMany(ids);
  });
}

export async function setCartQuantityAction(productId: number, quantity: number): Promise<ActionResult<CartChange>> {
  return runAction('cart.set_quantity', async () => {
    const p = id.safeParse(productId);
    const q = qty.safeParse(quantity);
    if (!p.success || !q.success) throw bad();
    return cartService.setQuantity(p.data, q.data);
  });
}

export async function removeFromCartAction(productId: number): Promise<ActionResult<CartChange>> {
  return setCartQuantityAction(productId, 0);
}

/** The mini-cart: the first five lines and the totals, priced now. */
export async function miniCartAction(): Promise<ActionResult<MiniCart>> {
  return runAction('cart.mini', async () => {
    const v = await cartService.view();
    return {
      units: v.units,
      itemsTotal: v.itemsTotal,
      items: v.items.slice(0, 5).map((i) => ({
        productId: i.productId,
        name: i.name,
        href: i.href,
        imageUrl: i.imageUrl,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      more: Math.max(0, v.items.length - 5),
    };
  });
}
