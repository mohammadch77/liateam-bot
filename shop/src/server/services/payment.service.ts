import 'server-only';
import { getConfig } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { createGateway, PAYMENT_PROVIDERS, type PaymentProviderId } from '@/lib/payment/registry';
import type { PaymentGateway } from '@/lib/payment/types';
import { paymentCallbackPath } from '@/lib/urls';
import { authorize } from '@/server/auth/guards';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import { secretSettingsService } from './secret-settings.service';
import { settingsRead } from './settings-read.service';

/**
 * The payment gateway chosen in the panel, built from the saved settings and the encrypted merchant id / key. The checkout
 * and the callback page call it through order-payment.service. The dev simulator is refused in production.
 */
async function build(id: PaymentProviderId): Promise<PaymentGateway> {
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
}

export const paymentService = {
  /** the active gateway for a NEW payment; throws AppError when online payment is off, misconfigured or not allowed here */
  async gateway(): Promise<{ id: PaymentProviderId; gateway: PaymentGateway }> {
    if (!(await settingsRead.get('payment.enabled')))
      throw new AppError('INVALID_DATA', { message: 'پرداخت آنلاین فعلاً در دسترس نیست.' });
    const id = await settingsRead.get('payment.provider');
    return { id, gateway: await build(id) };
  },

  /** the gateway of an attempt already under way (verifying it works even if online payment was switched off meanwhile) */
  gatewayById: build,

  /**
   * Asks the gateway about a return (the one place that does it, for orders and wallet top-ups): the customer backing out is
   * 'canceled', a gateway that cannot be reached is 'pending' (nothing is decided; the same return can be opened again), a refusal
   * is 'failed'. The amount asked for is the one saved with the attempt.
   */
  async verifyAttempt(
    payment: { gateway: string | null; amount: number },
    q: { authority: string; status: 'OK' | 'NOK' | null; sim: string | null },
  ): Promise<{ outcome: 'paid' | 'canceled' | 'failed' | 'pending'; refId?: string; card?: string }> {
    if (q.status === 'NOK') return { outcome: 'canceled' };
    try {
      const gw = await build(payment.gateway as PaymentProviderId);
      const v = await gw.verify({
        authority: q.authority,
        amount: payment.amount,
        query: { Authority: q.authority, Status: q.status ?? undefined, sim: q.sim ?? undefined },
      });
      if (v.outcome === 'error') return { outcome: 'pending' };
      if (v.outcome === 'paid') return { outcome: 'paid', refId: v.refId, card: v.cardMasked };
      return { outcome: v.outcome === 'canceled' ? 'canceled' : 'failed' };
    } catch (e) {
      logger.error('payment.verify_threw', { err: e instanceof Error ? e.name : 'unknown' });
      return { outcome: 'pending' };
    }
  },

  /** Can a customer pay online right now? (the settings are on and complete; the reason is logged, not shown) */
  async onlineAvailable(): Promise<boolean> {
    try {
      if (!(await settingsRead.get('payment.enabled'))) return false;
      if (!(await settingsRead.get('site.base_url'))) return false;
      const id = await settingsRead.get('payment.provider');
      const p = PAYMENT_PROVIDERS[id];
      if (getConfig().APP_ENV === 'production' && !p.production) return false;
      if (id !== 'dev' && !(await secretSettingsService.read('payment.merchant_id'))) return false;
      return true;
    } catch (e) {
      logger.warn('payment.availability_check_failed', { err: e instanceof Error ? e.message : 'unknown' });
      return false;
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
