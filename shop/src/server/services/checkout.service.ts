import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { PricedLine } from '@/lib/cart/totals';
import { deliveryWindow, type Eta } from '@/lib/orders/delivery';
import {
  assessReview,
  buildOrderDraft,
  type DraftFailure,
  type ReviewResult,
  type ReviewVerdict,
} from '@/lib/orders/review';
import { authorize } from '@/server/auth/guards';
import { dataChanged } from '@/server/cache-events';
import { rateLimit } from '@/server/http/rate-limit';
import { addressRepository, type AddressRow } from '@/server/repositories/address.repository';
import { botOrderRepository } from '@/server/repositories/bot-order.repository';
import { cartRepository, type CartRow } from '@/server/repositories/cart.repository';
import { orderRepository } from '@/server/repositories/order.repository';
import { shippingRepository } from '@/server/repositories/shipping.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { cartService } from './cart.service';
import { orderSettingsService } from './order-settings.service';

/**
 * Checkout, up to «pending_payment». Order of events: the customer picks an address → startReview puts a live
 * price / stock check of the cart in the sync bot's queue → reviewStatus is polled until the bot answers → if every line
 * can be supplied, placeOrder makes the order. The money of the order is computed here from the cart's shop prices and
 * Liateam's check (buildOrderDraft); the browser sends only an address id and the check's id. Nothing is made unless the
 * check is good, fresh and the cart's own.
 */
export type CheckoutLineView = {
  productId: number;
  name: string;
  href: string;
  imageUrl: string | null;
  /** what the customer asked for */
  quantity: number;
  /** what Liateam can supply */
  available: number;
  status: 'ok' | 'adjusted' | 'unavailable' | 'missing';
  unitPrice: number;
  unitListPrice: number;
  lineTotal: number;
  /** the price moved at Liateam while the cart was open */
  priceChanged: boolean;
  limited: boolean;
};

export type CheckoutView =
  | { state: 'pending' }
  | { state: 'failed'; message: string }
  | {
      state: 'ready';
      jobId: number;
      lines: CheckoutLineView[];
      /** true: the order can be made now */
      canOrder: boolean;
      /** the check's hold ends at this time (ISO); after it a new check is needed */
      expiresAt: string;
      expired: boolean;
      /** the cart was changed after the check */
      cartChanged: boolean;
      /** why nothing can be ordered (the bot's reason), when it said so */
      reason: string | null;
      /** all set when canOrder */
      totals: {
        itemsTotal: number;
        discountTotal: number;
        shippingCharged: number;
        shippingFree: boolean;
        totalPayable: number;
      } | null;
      shippingTitle: string | null;
      delivery: { minDays: number; maxDays: number } | null;
      anyPriceChanged: boolean;
      hasUnavailable: boolean;
      hasAdjusted: boolean;
    };

const REASONS: Record<DraftFailure, string> = {
  not_ok: 'این سبد در حال حاضر قابل ثبت نیست. دوباره بررسی کنید.',
  expired: 'مهلت بررسی قیمت و موجودی تمام شد. دوباره بررسی کنید.',
  cart_changed: 'سبد بعد از بررسی تغییر کرده است. دوباره بررسی کنید.',
  stale_price: 'قیمت یکی از کالاها تغییر کرده است. دوباره بررسی کنید.',
  inconsistent: 'جمع قیمت‌ها با بررسی نمی‌خواند. دوباره بررسی کنید.',
};

const supplierUnavailable = () =>
  new AppError('DB_UNAVAILABLE', { message: 'اتصال به سامانه‌ی تأمین‌کننده برقرار نشد. دوباره تلاش کنید.' });

async function ownCart(userId: string): Promise<CartRow> {
  const cart = await cartRepository.findOpenForUser(userId);
  if (!cart) throw new AppError('INVALID_DATA', { message: 'سبد خرید خالی است.' });
  return cart;
}

/** The check of this cart, or throws: it must be the one the cart is on (nobody reads another's job). */
async function checkOf(cart: CartRow, jobId: number) {
  if (!Number.isInteger(jobId) || cart.review_id !== jobId) throw new AppError('FORBIDDEN');
  const r = await botOrderRepository.reviewResult(jobId);
  if (!r) throw new AppError('FORBIDDEN');
  return r;
}

async function etaFor(provinceId: number | null): Promise<Eta | null> {
  const methods = await shippingRepository.activeMethods();
  const post = methods.find((m) => m.code === 'post') ?? methods[0];
  if (!post) return null;
  const rule =
    post.rules.find((r) => r.province_id === provinceId) ?? post.rules.find((r) => r.province_id === null);
  if (rule) return { minDays: rule.eta_min_days, maxDays: rule.eta_max_days };
  return post.eta_min_days !== null && post.eta_max_days !== null
    ? { minDays: post.eta_min_days, maxDays: post.eta_max_days }
    : null;
}

const toLineView = (l: PricedLine, v: ReviewVerdict['lines'][number]): CheckoutLineView => ({
  productId: l.productId,
  name: l.name,
  href: l.href,
  imageUrl: l.imageUrl,
  quantity: l.quantity,
  available: v.available,
  status: v.status,
  unitPrice: l.unitPrice,
  unitListPrice: l.unitListPrice,
  lineTotal: l.unitPrice * l.quantity,
  priceChanged: v.priceChanged !== null,
  limited: v.limited,
});

export const checkoutService = {
  /** Starts the live check of the cart for an address; returns the id to poll. */
  async startReview(addressId: string): Promise<{ jobId: number }> {
    const user = await authorize();
    rateLimit(`review:${user.id}`, 20, 60_000);
    const cart = await ownCart(user.id);
    const view = await cartService.view();
    if (view.empty) throw new AppError('INVALID_DATA', { message: 'سبد خرید خالی است.' });
    const address = await addressRepository.find(user.id, addressId);
    if (!address || address.city_id === null || address.province_id === null) {
      throw new AppError('INVALID_DATA', { message: 'آدرس معتبر انتخاب کنید.' });
    }
    try {
      const jobId = await botOrderRepository.enqueueReview(
        address.city_id,
        view.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        cart.review_id,
      );
      await cartRepository.setReview(cart.id, jobId);
      return { jobId };
    } catch (e) {
      logger.error('checkout.enqueue_failed', { err: e });
      throw supplierUnavailable();
    }
  },

  /** The state of the check: pending, failed, or ready with the lines, what is wrong with them and the totals. */
  async reviewStatus(jobId: number, addressId: string): Promise<CheckoutView> {
    const user = await authorize();
    const cart = await ownCart(user.id);
    const r = await checkOf(cart, jobId);
    if (!r.done) return { state: 'pending' };
    if (!r.ok || !r.result || 'error' in (r.result as object)) {
      logger.warn('checkout.review_failed', { job: jobId });
      return { state: 'failed', message: 'اتصال به سامانه‌ی تأمین‌کننده برقرار نشد. دوباره تلاش کنید.' };
    }
    const review = r.result as ReviewResult;
    // the bot stored a new Liateam price: the shop's prices are computed again BEFORE the cart is read below
    if (review.items.some((i) => i.price_changed)) dataChanged();
    const view = await cartService.view();
    const verdict = assessReview(view.items, review);
    const anyPriceChanged = verdict.lines.some((l) => l.priceChanged);

    const settings = await orderSettingsService.get();
    const address = await addressRepository.find(user.id, addressId);
    const eta = await etaFor(address?.province_id ?? null);
    const window = deliveryWindow(eta, null, settings.deliveryExtraDays);
    const draft = verdict.canOrder ? buildOrderDraft(view.items, review, settings.freeShipping) : null;
    const byId = new Map(verdict.lines.map((v) => [v.productId, v]));
    return {
      state: 'ready',
      jobId,
      lines: view.items.flatMap((l) => {
        const v = byId.get(l.productId);
        return v ? [toLineView(l, v)] : [];
      }),
      canOrder: draft?.ok === true,
      expiresAt: review.expires_at,
      expired: verdict.expired,
      cartChanged:
        view.items.some((l) => !review.items.some((i) => i.product_id === l.productId)) ||
        review.items.some((i) => !view.items.some((l) => l.productId === i.product_id)),
      reason: review.ok ? null : review.reason,
      totals:
        draft?.ok === true
          ? {
              itemsTotal: draft.draft.itemsTotal,
              discountTotal: draft.draft.discountTotal,
              shippingCharged: draft.draft.shipping.charged,
              shippingFree: draft.draft.shipping.free,
              totalPayable: draft.draft.totalPayable,
            }
          : null,
      shippingTitle: review.shipping?.title ?? null,
      delivery: window ? { minDays: window.minDays, maxDays: window.maxDays } : null,
      anyPriceChanged,
      hasUnavailable: verdict.unavailable.length > 0,
      hasAdjusted: verdict.adjusted.length > 0,
    };
  },

  /** Takes the unavailable products out of the cart and lowers the others to what Liateam has (then a new check is needed). */
  async applyReviewToCart(jobId: number): Promise<void> {
    const user = await authorize();
    rateLimit(`review:${user.id}`, 30, 60_000);
    const cart = await ownCart(user.id);
    const r = await checkOf(cart, jobId);
    if (!r.done || !r.ok || !r.result || 'error' in (r.result as object)) throw new AppError('INVALID_DATA');
    const view = await cartService.view();
    const verdict = assessReview(view.items, r.result as ReviewResult);
    await withTransaction(async (db) => {
      for (const id of verdict.unavailable) await cartRepository.setQuantity(cart.id, id, 0, db);
      for (const a of verdict.adjusted)
        await cartRepository.setQuantity(cart.id, a.productId, a.quantity, db);
      await cartRepository.setReview(cart.id, null, db);
    });
  },

  /**
   * Makes the order (pending_payment) from the cart and a good, fresh check. Pressing twice — or replaying the request —
   * returns the same order: the key is the user and the check. Payment is the next step.
   */
  async placeOrder(addressId: string, jobId: number): Promise<{ number: string; created: boolean }> {
    const user = await authorize();
    rateLimit(`order:${user.id}`, 10, 60_000);
    const cart = await ownCart(user.id);
    const r = await checkOf(cart, jobId);
    if (!r.done || !r.ok || !r.result || 'error' in (r.result as object)) throw supplierUnavailable();
    const review = r.result as ReviewResult;
    const address: AddressRow | null = await addressRepository.find(user.id, addressId);
    if (!address || address.city_id === null || address.province_id === null || !address.plate) {
      throw new AppError('INVALID_DATA', { message: 'آدرس معتبر انتخاب کنید.' });
    }
    if (review.city_id !== address.city_id) {
      throw new AppError('INVALID_DATA', {
        message: 'شهر آدرس با شهر بررسی‌شده یکی نیست. دوباره بررسی کنید.',
      });
    }
    const view = await cartService.view();
    const settings = await orderSettingsService.get();
    const made = buildOrderDraft(view.items, review, settings.freeShipping);
    if (!made.ok) throw new AppError('INVALID_DATA', { message: REASONS[made.reason] });
    const d = made.draft;
    const window = deliveryWindow(await etaFor(address.province_id), null, settings.deliveryExtraDays);

    const result = await withTransaction(async (db) => {
      const { order, created } = await orderRepository.create(
        {
          userId: user.id,
          idempotencyKey: `checkout:review:${user.id}:${jobId}`,
          paymentMethod: 'gateway',
          recipientName: address.recipient_name,
          recipientPhone: address.recipient_phone,
          province: address.province,
          city: address.city,
          provinceId: address.province_id!,
          cityId: address.city_id!,
          postalCode: address.postal_code,
          line: address.line,
          plate: address.plate!,
          unit: address.unit,
          itemsTotal: d.itemsTotal,
          discountTotal: d.discountTotal,
          shippingSupplierPrice: d.shipping.supplierPrice,
          shippingCharged: d.shipping.charged,
          reviewId: jobId,
          liveTotal: d.expectedTotal,
          liveExpiresAt: new Date(review.expires_at),
          deliveryEtaMinDays: window?.minDays ?? null,
          deliveryEtaMaxDays: window?.maxDays ?? null,
          items: d.items.map((i) => ({
            productId: i.productId,
            name: i.name,
            quantity: i.quantity,
            unitListPrice: i.unitListPrice,
            unitPrice: i.unitPrice,
            discountPercent: i.discountPercent,
          })),
        },
        db,
      );
      if (created)
        await orderRepository.appendEvent(
          order.id,
          'created',
          user.id,
          { reviewId: jobId, items: d.items.length },
          db,
        );
      return { number: order.number, created };
    });
    logger.info('checkout.order_created', { created: result.created });
    return result;
  },
};
