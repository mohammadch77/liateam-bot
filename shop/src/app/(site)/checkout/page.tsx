import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cartPath, checkoutPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { addressService } from '@/server/services/address.service';
import { cartService } from '@/server/services/cart.service';
import { Breadcrumb, Container } from '@/ui';
import type { AddressView } from './actions';
import { CheckoutFlow } from './CheckoutFlow';
import s from './checkout.module.css';

export const metadata: Metadata = { title: 'تسویه‌حساب', robots: { index: false, follow: false } };

/** «تسویه‌حساب»: signed-in only (a guest is sent to the login and comes back here); an empty cart goes back to the cart. */
export default async function CheckoutPage() {
  const user = await requireUser(checkoutPath());
  const cart = await cartService.view();
  if (cart.empty) redirect(cartPath());
  const addresses: AddressView[] = (await addressService.list(user.id)).map((a) => ({
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
  }));
  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'سبد خرید', href: cartPath() }, { label: 'تسویه‌حساب' }]} />
      <h1 className={s.title}>تسویه‌حساب</h1>
      <CheckoutFlow addresses={addresses} defaultPhone={user.phone} defaultName={user.fullName ?? ''} />
    </Container>
  );
}
