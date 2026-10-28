import 'server-only';
import { cache } from 'react';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  capQuantity,
  discountPercentOf,
  maxQuantity,
  mergeCartItems,
  totalsOf,
  type CartTotals,
  type PricedLine,
} from '@/lib/cart/totals';
import { clearCartToken, hashCartToken, issueCartToken, readCartToken } from '@/server/cart/cookie';
import { rateLimit } from '@/server/http/rate-limit';
import { cartRepository, type CartRow } from '@/server/repositories/cart.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { catalogService } from './catalog.service';
import { getCurrentUser, type CurrentUser } from './session.service';

/**
 * The shopping cart. The owner is always derived on the server — the signed-in user, or the guest cookie's hash — and
 * no function takes a cart id from the browser, so nobody can reach another cart. A line is (product, quantity); prices
 * are computed here from the catalog and the database's price function every time (catalogService.productViews), never read
 * from the browser. A product that is not sold any more (a sample, discontinued) or is out of stock cannot be added and
 * does not show in the cart.
 */
export type CartLine = PricedLine & {
  /** the most this line can hold now (stock, never above 50) */
  maxQuantity: number;
  /** percent off Liateam's list price, 0 when none */
  discountPercent: number;
  lineTotal: number;
};

export type CartView = CartTotals & { cartId: string | null; items: CartLine[]; empty: boolean };

/** What the page needs after a change: the new badge and the line that changed. */
export type CartChange = { units: number; quantity: number; capped: boolean };

const EMPTY: CartView = {
  cartId: null,
  items: [],
  empty: true,
  units: 0,
  lines: 0,
  itemsTotal: 0,
  listTotal: 0,
  discountTotal: 0,
};

type Owner = { user: CurrentUser | null; guestHash: string | null };

async function owner(): Promise<Owner> {
  const user = await getCurrentUser();
  const token = await readCartToken();
  return { user, guestHash: token ? hashCartToken(token) : null };
}

const limitKey = (o: Owner) => (o.user ? `cart:u:${o.user.id}` : `cart:g:${o.guestHash ?? 'none'}`);

/** The cart to read: the user's, else the guest's (null: none yet). */
async function existingCart(o: Owner): Promise<CartRow | null> {
  if (o.user) return cartRepository.findOpenForUser(o.user.id);
  return o.guestHash ? cartRepository.findOpenForGuest(o.guestHash) : null;
}

/** The cart to change: made on the first add (a guest gets a cookie then). */
async function cartForWrite(o: Owner): Promise<CartRow> {
  if (o.user) return cartRepository.openForUser(o.user.id);
  const hash = o.guestHash ?? hashCartToken(await issueCartToken());
  return cartRepository.openForGuest(hash);
}

async function lines(cart: CartRow): Promise<CartLine[]> {
  const items = await cartRepository.items(cart.id);
  if (!items.length) return [];
  const views = await catalogService.productViews(items.map((i) => i.product_id));
  const out: CartLine[] = [];
  for (const i of items) {
    const v = views.get(i.product_id);
    if (!v || v.stock === 'out' || v.stockCount <= 0) continue; // no longer sold, or none left
    const unitListPrice = v.oldPriceToman ?? v.priceToman;
    const quantity = Math.min(i.quantity, maxQuantity(v.stockCount));
    out.push({
      productId: v.id,
      name: v.name,
      href: v.href,
      imageUrl: v.imageUrl ?? null,
      quantity,
      unitPrice: v.priceToman,
      unitListPrice,
      stockCount: v.stockCount,
      maxQuantity: maxQuantity(v.stockCount),
      discountPercent: discountPercentOf(v.priceToman, unitListPrice),
      lineTotal: v.priceToman * quantity,
    });
  }
  return out;
}

export const cartService = {
  /** The cart of this request, priced now (an empty view when there is none). */
  view: cache(async (): Promise<CartView> => {
    try {
      const cart = await existingCart(await owner());
      if (!cart) return EMPTY;
      const items = await lines(cart);
      return { cartId: cart.id, items, empty: items.length === 0, ...totalsOf(items) };
    } catch (e) {
      logger.warn('cart.view_failed', { err: e });
      return EMPTY; // a page never fails because of the badge
    }
  }),

  /** The header badge: units that can still be bought. 0 on any failure. */
  badge: cache(async (): Promise<number> => {
    try {
      const cart = await existingCart(await owner());
      return cart ? await cartRepository.units(cart.id) : 0;
    } catch {
      return 0;
    }
  }),

  /** Adds `quantity` units of a product; the line is held at the stock (and at 50). */
  async add(productId: number, quantity = 1): Promise<CartChange> {
    const o = await owner();
    rateLimit(limitKey(o), 120, 60_000);
    if (!Number.isInteger(productId) || productId <= 0) throw new AppError('INVALID_DATA');
    const q = Math.trunc(quantity);
    if (!Number.isInteger(q) || q < 1 || q > 50) throw new AppError('INVALID_DATA');
    const view = (await catalogService.productViews([productId])).get(productId);
    if (!view) throw new AppError('INVALID_REFERENCE', { message: 'این کالا قابل خرید نیست.' });
    if (view.stock === 'out' || view.stockCount <= 0) {
      throw new AppError('INVALID_DATA', { message: 'این کالا فعلاً ناموجود است.' });
    }
    const cart = await cartForWrite(o);
    const have = (await cartRepository.items(cart.id)).find((i) => i.product_id === productId)?.quantity ?? 0;
    const next = capQuantity(have + q, view.stockCount);
    if (next === have) {
      throw new AppError('INVALID_DATA', { message: 'به سقف موجودی این کالا رسیده‌اید.' });
    }
    await cartRepository.setQuantity(cart.id, productId, next);
    return { units: await cartRepository.units(cart.id), quantity: next, capped: have + q > next };
  },

  /** Sets a line's quantity (0 takes it out); never above the stock. */
  async setQuantity(productId: number, quantity: number): Promise<CartChange> {
    const o = await owner();
    rateLimit(limitKey(o), 120, 60_000);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity < 0) {
      throw new AppError('INVALID_DATA');
    }
    const cart = await existingCart(o);
    if (!cart) throw new AppError('NOT_FOUND');
    let next = 0;
    if (quantity > 0) {
      const view = (await catalogService.productViews([productId])).get(productId);
      next = view ? capQuantity(quantity, view.stockCount) : 0;
    }
    await cartRepository.setQuantity(cart.id, productId, next);
    return {
      units: await cartRepository.units(cart.id),
      quantity: next,
      capped: quantity > next && next > 0,
    };
  },

  remove(productId: number): Promise<CartChange> {
    return this.setQuantity(productId, 0);
  },

  /** Adds each product once (a pack's items); products that cannot be added are skipped. Returns how many were added. */
  async addMany(productIds: readonly number[]): Promise<{ added: number; skipped: number; units: number }> {
    let added = 0;
    let skipped = 0;
    let units = 0;
    for (const id of [...new Set(productIds)]) {
      try {
        units = (await this.add(id, 1)).units;
        added += 1;
      } catch (e) {
        if (e instanceof AppError && e.code === 'RATE_LIMITED') throw e;
        skipped += 1;
      }
    }
    if (!added) throw new AppError('INVALID_DATA', { message: 'هیچ‌کدام از اقلام این پک قابل افزودن نبود.' });
    return { added, skipped, units: units || (await this.badge()) };
  },

  /**
   * After sign-in: what the guest had is added to the user's cart (quantities add up, held at the stock), the guest
   * cart is closed and its cookie removed. Safe to call when there is no guest cart.
   */
  async mergeGuestIntoUser(userId: string): Promise<number> {
    const token = await readCartToken();
    if (!token) return 0;
    const guest = await cartRepository.findOpenForGuest(hashCartToken(token));
    await clearCartToken();
    if (!guest) return 0;
    const guestItems = await cartRepository.items(guest.id);
    if (!guestItems.length) {
      return 0;
    }
    const userCart = await cartRepository.openForUser(userId);
    const userItems = await cartRepository.items(userCart.id);
    const views = await catalogService.productViews([...userItems, ...guestItems].map((i) => i.product_id));
    const merged = mergeCartItems(
      userItems.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
      guestItems.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
      (id) => views.get(id)?.stockCount ?? 0,
    );
    await withTransaction(async (db) => {
      for (const m of merged) await cartRepository.setQuantity(userCart.id, m.productId, m.quantity, db);
      await cartRepository.closeMerged(guest.id, userCart.id, db);
    });
    logger.info('cart.merged', { lines: merged.length });
    return merged.length;
  },
};
