import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { digitsOnly, normalizeMobile } from '@/lib/phone';
import { rateLimit } from '@/server/http/rate-limit';
import { addressRepository, type AddressRow } from '@/server/repositories/address.repository';
import { geoRepository } from '@/server/repositories/geo.repository';
import { authorize } from '@/server/auth/guards';

/**
 * The signed-in user's delivery addresses. A new address is checked here (Persian messages), the province and city must be
 * Liateam's (their ids and names come from the geo list kept in the database, never from the browser) and the row always
 * belongs to the user who is signed in.
 */
const schema = z.object({
  provinceId: z.coerce.number().int().positive(),
  cityId: z.coerce.number().int().positive(),
  line: z.string().trim().min(5, 'نشانی را کامل بنویسید.').max(400, 'نشانی بیش از حد طولانی است.'),
  plate: z.string().trim().min(1, 'پلاک را بنویسید.').max(20, 'پلاک معتبر نیست.'),
  unit: z.string().trim().max(20, 'واحد معتبر نیست.').optional().default(''),
  recipientName: z
    .string()
    .trim()
    .min(2, 'نام گیرنده را بنویسید.')
    .max(120, 'نام گیرنده بیش از حد طولانی است.'),
  recipientPhone: z.string().trim().min(1, 'موبایل گیرنده را بنویسید.'),
  postalCode: z.string().trim().min(1, 'کد پستی را بنویسید.'),
  makeDefault: z.boolean().optional().default(false),
});

export const addressService = {
  async list(userId: string): Promise<AddressRow[]> {
    return addressRepository.listForUser(userId);
  },

  async add(raw: unknown): Promise<AddressRow> {
    const user = await authorize();
    rateLimit(`address:${user.id}`, 10, 10 * 60_000);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('INVALID_DATA', {
        message: parsed.error.issues[0]?.message ?? 'اطلاعات آدرس معتبر نیست.',
      });
    }
    const a = parsed.data;
    const phone = normalizeMobile(a.recipientPhone);
    if (!phone)
      throw new AppError('INVALID_DATA', { message: 'موبایل گیرنده معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹).' });
    const postal = digitsOnly(a.postalCode);
    if (!/^\d{10}$/.test(postal))
      throw new AppError('INVALID_DATA', { message: 'کد پستی باید ۱۰ رقم باشد.' });
    const names = await geoRepository.cityName(a.provinceId, a.cityId);
    if (!names) throw new AppError('INVALID_DATA', { message: 'استان و شهر را از فهرست انتخاب کنید.' });
    return addressRepository.create(user.id, {
      province: names.province,
      city: names.city,
      provinceId: a.provinceId,
      cityId: a.cityId,
      line: a.line,
      plate: a.plate,
      unit: a.unit || null,
      recipientName: a.recipientName,
      recipientPhone: phone,
      postalCode: postal,
      makeDefault: a.makeDefault,
    });
  },
};
