import type { Metadata } from 'next';
import { addressesPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { addressService } from '@/server/services/address.service';
import { Breadcrumb, EmptyState } from '@/ui';
import type { AddressView } from '../../checkout/actions';
import s from '../account.module.css';
import { AddressBook } from './AddressBook';

export const metadata: Metadata = { title: 'آدرس‌ها', robots: { index: false } };

/** The signed-in user's addresses: add, edit, delete and choose the default (Liateam's province and city ids). */
export default async function AddressesPage() {
  const user = await requireUser(addressesPath());
  const list = await addressService.list(user.id).catch(() => null);
  const initial: AddressView[] | null = list
    ? list.map((a) => ({
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
      }))
    : null;
  return (
    <>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'آدرس‌ها' }]}
      />
      <h1 className={s.title}>آدرس‌های من</h1>
      {initial ? (
        <AddressBook initial={initial} defaultName={user.fullName ?? ''} defaultPhone={user.phone} />
      ) : (
        <EmptyState icon="error" tone="danger" title="آدرس‌ها بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      )}
    </>
  );
}
