'use server';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { runAction, type ActionResult } from '@/server/http/action';
import type { CartSnapshot } from '@/lib/cart/snapshot';
import { cartService, type CartChange } from '@/server/services/cart.service';
import { packService } from '@/server/services/pack.service';

/**
 * Cart actions (Server Actions: same-origin checked, rate limited in the service). The browser sends product codes and
 * quantities only — never a price, never a cart id: the owner is the signed-in user or the guest cookie.
 */
const id = z.number().int().refine((n) => n !== 0);
const qty = z.number().int().min(0).max(50);
const bad = () => new AppError('INVALID_DATA');

export async function addToCartAction(productId: number, quantity = 1): Promise<ActionResult<CartChange>> {
  return runAction('cart.add', async () => {
    const p = z.number().int().positive().safeParse(productId);
    const q = z.number().int().min(1).max(50).safeParse(quantity);
    if (!p.success || !q.success) throw bad();
    return cartService.add(p.data, q.data);
  });
}

/** Adds a pack as a unified bundle into the cart (the pack comes from the database, not from the browser). */
export async function addPackToCartAction(
  collection: string,
  variant: string,
): Promise<ActionResult<CartChange>> {
  return runAction('cart.add_pack', async () => {
    const found = await packService.pack(String(collection).slice(0, 80), String(variant).slice(0, 80));
    if (!found || !found.pack.available)
      throw new AppError('INVALID_DATA', { message: 'این پک فعلاً در دسترس نیست.' });
    return cartService.addPack(found.pack.id, 1);
  });
}

export async function setCartQuantityAction(
  productId: number,
  quantity: number,
): Promise<ActionResult<CartChange>> {
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

/** The cart as it is now: the one snapshot the header, the mini-cart and the cart page all show (read again whenever a view opens). */
export async function cartSnapshotAction(): Promise<ActionResult<CartSnapshot>> {
  return runAction('cart.snapshot', () => cartService.snapshot());
}
