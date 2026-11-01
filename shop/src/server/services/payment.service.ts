import 'server-only';
import { getConfig } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { createGateway, PAYMENT_PROVIDERS } from '@/lib/payment/registry';
import type { PaymentGateway } from '@/lib/payment/types';
import { paymentCallbackPath } from '@/lib/urls';
import { authorize } from '@/server/auth/guards';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import { secretSettingsService } from './secret-settings.service';
import { settingsRead } from './settings-read.service';

/**
 * The payment gateway chosen in the panel, built from the saved settings and the encrypted merchant id / key. The checkout
 * does not use it yet (the next step wires it in); this service is what it will call. The dev simulator is refused in
 * production.
 */
export const paymentService = {
  /** the active gateway; throws AppError when payment is off, misconfigured or the provider is not allowed here */
  async gateway(): Promise<PaymentGateway> {
    if (!(await settingsRead.get('payment.enabled')))
      throw new AppError('INVALID_DATA', { message: 'پرداخت آنلاین غیرفعال است.' });
    const id = await settingsRead.get('payment.provider');
    try {
      return createGateway(
        id,
        {
          merchantId: (await secretSettingsService.read('payment.merchant_id')) ?? '',
          apiKey: (await secretSettingsService.read('payment.api_key')) ?? undefined,
          sandbox: await settingsRead.get('payment.sandbox'),
        },
        getConfig().APP_ENV === 'production',
      );
    } catch (e) {
      logger.error('payment.gateway_unavailable', {
        provider: id,
        err: e instanceof Error ? e.message : 'unknown',
      });
      throw new AppError('INTERNAL', { message: 'درگاه پرداخت در دسترس نیست.', cause: e });
    }
  },

  /** where the gateway sends the buyer back: the site base URL (settings) + the callback path */
  async callbackUrl(): Promise<string> {
    const base = await settingsRead.get('site.base_url');
    if (!base)
      throw new AppError('INVALID_DATA', { message: 'آدرس پایه‌ی سایت در تنظیمات عمومی وارد نشده است.' });
    return `${base}${paymentCallbackPath()}`;
  },

  /**
   * «تست اتصال»: a harmless check of what is saved (format of the merchant id, the callback address, whether the provider is
   * allowed here). No network call to the gateway, no transaction. Audited.
   */
  async testConnection(meta: RequestMeta): Promise<{ ok: boolean; message: string }> {
    const admin = await authorize('admin');
    let result: { ok: boolean; message: string };
    const id = await settingsRead.get('payment.provider');
    try {
      const p = PAYMENT_PROVIDERS[id];
      if (getConfig().APP_ENV === 'production' && !p.production) {
        result = { ok: false, message: 'شبیه‌ساز روی سایت اصلی مجاز نیست؛ درگاه واقعی را انتخاب کنید.' };
      } else {
        const gw = p.create({
          merchantId: (await secretSettingsService.read('payment.merchant_id')) ?? '',
          apiKey: (await secretSettingsService.read('payment.api_key')) ?? undefined,
          sandbox: await settingsRead.get('payment.sandbox'),
        });
        const check = gw.selfCheck();
        const base = await settingsRead.get('site.base_url');
        const notes = [check.message];
        if (!base) notes.push('آدرس پایه‌ی سایت (برای بازگشت از درگاه) هنوز وارد نشده است.');
        if (!p.verified) notes.push('هشدار: این درگاه هنوز با سرویس واقعی آزمایش نشده است.');
        result = { ok: check.ok && !!base, message: notes.join(' ') };
      }
    } catch (e) {
      result = {
        ok: false,
        message:
          e instanceof AppError && e.code === 'CONFIG_INVALID'
            ? e.message
            : 'بررسی انجام نشد؛ تنظیمات درگاه را کامل کنید.',
      };
    }
    await auditRepository.record({
      actorUserId: admin.id,
      action: 'payment.test',
      entityType: 'setting',
      entityId: 'payment',
      meta: { ok: result.ok, provider: id },
      ip: meta.ip,
    });
    return result;
  },
};
