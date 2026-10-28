'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { orderPath } from '@/lib/urls';
import { authorize } from '@/server/auth/guards';
import { runAction, type ActionResult } from '@/server/http/action';
import { rateLimit } from '@/server/http/rate-limit';
import type { AddressRow } from '@/server/repositories/address.repository';
import type { GeoItem } from '@/server/repositories/geo.repository';
import { addressService } from '@/server/services/address.service';
import { checkoutService, type CheckoutView } from '@/server/services/checkout.service';
import { geoService } from '@/server/services/geo.service';

/**
 * Checkout actions. All need a signed-in user; the browser sends an address id and the id of the live check — never a
 * price, a total or a cart. The order's money is computed on the server (checkout.service).
 */
const id = z.number().int().positive();
const text = z.string().trim().min(1).max(40);

export type AddressView = Pick<
  AddressRow,
  'id' | 'province' | 'city' | 'province_id' | 'city_id' | 'line' | 'plate' | 'unit' | 'recipient_name' | 'recipient_phone' | 'postal_code' | 'is_default'
>;

const view = (a: AddressRow): AddressView => ({
  id: a.id,
  province: a.province,
  city: a.city,
  province_id: a.province_id,
  city_id: a.city_id,
  line: a.line,
  plate: a.plate,
  unit: a.unit,
  recipient_name: a.recipient_name,
  recipient_phone: a.recipient_phone,
  postal_code: a.postal_code,
  is_default: a.is_default,
});

export async function provincesAction(): Promise<ActionResult<GeoItem[]>> {
  return runAction('checkout.provinces', async () => {
    const user = await authorize();
    rateLimit(`geo:${user.id}`, 30, 60_000);
    return geoService.provinces();
  });
}

export async function citiesAction(provinceId: number): Promise<ActionResult<GeoItem[]>> {
  return runAction('checkout.cities', async () => {
    const user = await authorize();
    rateLimit(`geo:${user.id}`, 30, 60_000);
    const p = id.safeParse(provinceId);
    if (!p.success) throw new AppError('INVALID_DATA');
    return geoService.cities(p.data);
  });
}

export async function addAddressAction(input: {
  provinceId: number;
  cityId: number;
  line: string;
  plate: string;
  unit?: string;
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  makeDefault?: boolean;
}): Promise<ActionResult<AddressView>> {
  return runAction('checkout.add_address', async () => view(await addressService.add(input)));
}

export async function startReviewAction(addressId: string): Promise<ActionResult<{ jobId: number }>> {
  return runAction('checkout.start_review', async () => {
    const a = text.safeParse(String(addressId));
    if (!a.success) throw new AppError('INVALID_DATA');
    return checkoutService.startReview(a.data);
  });
}

export async function reviewStatusAction(jobId: number, addressId: string): Promise<ActionResult<CheckoutView>> {
  return runAction('checkout.review_status', async () => {
    const j = id.safeParse(jobId);
    const a = text.safeParse(String(addressId));
    if (!j.success || !a.success) throw new AppError('INVALID_DATA');
    return checkoutService.reviewStatus(j.data, a.data);
  });
}

/** «حذف ناموجودها و اعمال تعدیل‌ها»: the cart follows what Liateam can supply; then a new check is started by the page. */
export async function applyReviewAction(jobId: number): Promise<ActionResult<null>> {
  return runAction('checkout.apply_review', async () => {
    const j = id.safeParse(jobId);
    if (!j.success) throw new AppError('INVALID_DATA');
    await checkoutService.applyReviewToCart(j.data);
    return null;
  });
}

/** Makes the order (pending_payment) and goes to its page; pressing twice makes one order. */
export async function placeOrderAction(addressId: string, jobId: number): Promise<ActionResult<null>> {
  const made = await runAction('checkout.place_order', async () => {
    const a = text.safeParse(String(addressId));
    const j = id.safeParse(jobId);
    if (!a.success || !j.success) throw new AppError('INVALID_DATA');
    return checkoutService.placeOrder(a.data, j.data);
  });
  if (!made.ok) return made;
  // redirect() throws a control-flow signal, so it stays outside runAction's try/catch
  redirect(orderPath(made.data.number));
}
