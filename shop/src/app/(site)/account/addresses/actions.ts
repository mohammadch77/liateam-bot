'use server';

import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/http/action';
import type { AddressRow } from '@/server/repositories/address.repository';
import { addressService } from '@/server/services/address.service';
import type { AddressView } from '../../checkout/actions';

/** Address book actions. Every one acts on the signed-in user's own addresses; another user's id is «not found». */
const id = z.string().regex(/^\d{1,18}$/);

type Input = {
  provinceId: number;
  cityId: number;
  line: string;
  plate: string;
  unit?: string;
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  makeDefault?: boolean;
};

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

export async function createAddressAction(input: Input): Promise<ActionResult<AddressView>> {
  return runAction('account.address_add', async () => view(await addressService.add(input)));
}

export async function updateAddressAction(addressId: string, input: Input): Promise<ActionResult<AddressView>> {
  return runAction('account.address_update', async () => view(await addressService.update(id.parse(addressId), input)));
}

export async function makeDefaultAddressAction(addressId: string): Promise<ActionResult<null>> {
  return runAction('account.address_default', async () => {
    await addressService.setDefault(id.parse(addressId));
    return null;
  });
}

export async function deleteAddressAction(addressId: string): Promise<ActionResult<null>> {
  return runAction('account.address_delete', async () => {
    await addressService.remove(id.parse(addressId));
    return null;
  });
}
