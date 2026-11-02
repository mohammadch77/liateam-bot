import 'server-only';
import { getConfig } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { maskMobile } from '@/lib/phone';
import { paramsFor, SMS_EVENTS, type SmsEventKey, type SmsVariable } from '@/lib/sms/events';
import { createSmsProvider, SMS_PROVIDERS, type SmsProviderId } from '@/lib/sms/registry';
import { SmsError, type SmsCredentials, type SmsProvider } from '@/lib/sms/types';
import { authorize } from '@/server/auth/guards';
import { auditRepository } from '@/server/repositories/audit.repository';
import { smsLogRepository, type SmsPurpose } from '@/server/repositories/sms-log.repository';
import { rateLimit } from '@/server/http/rate-limit';
import type { RequestMeta } from '@/server/http/request';
import { secretSettingsService } from './secret-settings.service';
import { settingsRead } from './settings-read.service';

/**
 * Every SMS the shop sends goes through here: the active provider (chosen in the panel, or the server's .env while the
 * panel says «تنظیم سرور»), the credentials from the encrypted store, and a row in sms_log for each attempt (who, why,
 * whether it went out: never the text and never a code). The dev provider is refused in production.
 */
const devLog = (line: Record<string, unknown>) => {
  const { event, ...rest } = line;
  logger.info(String(event ?? 'sms.dev'), rest);
};

async function resolve(): Promise<{ provider: SmsProvider; id: SmsProviderId }> {
  const c = getConfig();
  const isProduction = c.APP_ENV === 'production';
  const chosen = await settingsRead.get('sms.provider');
  try {
    if (chosen === 'env') {
      const id: SmsProviderId = c.SMS_PROVIDER;
      return {
        id,
        provider: createSmsProvider(
          id,
          { apiKey: c.KAVENEGAR_API_KEY ?? '', otpTemplate: c.KAVENEGAR_OTP_TEMPLATE ?? '', log: devLog },
          isProduction,
        ),
      };
    }
    const creds: SmsCredentials = {
      apiKey: chosen === 'dev' ? '' : ((await secretSettingsService.read('sms.api_key')) ?? ''),
      sender: await settingsRead.get('sms.sender'),
      otpTemplate: await settingsRead.get('sms.otp_template'),
      endpoint: await settingsRead.get('sms.endpoint'),
      log: devLog,
    };
    if (chosen !== 'dev' && !creds.apiKey) throw new SmsError('misconfigured', 'no api key saved');
    return { id: chosen, provider: createSmsProvider(chosen, creds, isProduction) };
  } catch (e) {
    logger.error('sms.provider_unavailable', {
      provider: chosen,
      err: e instanceof Error ? e.message : 'unknown',
    });
    throw new AppError('SMS_FAILED', { cause: e });
  }
}

async function logged<T>(
  s: {
    phone: string;
    purpose: SmsPurpose;
    provider: SmsProviderId;
    userId?: string | null;
    orderId?: string | null;
  },
  send: () => Promise<T>,
): Promise<T> {
  let logId: string | null = null;
  try {
    logId = await smsLogRepository.record(s);
  } catch (e) {
    logger.warn('sms.log_failed', { err: e }); // a log failure must not stop a login code
  }
  try {
    const r = await send();
    if (logId)
      await smsLogRepository
        .setStatus(logId, 'sent', { providerRef: (r as { providerRef?: string })?.providerRef ?? null })
        .catch(() => {});
    return r;
  } catch (e) {
    const detail = e instanceof SmsError ? `${e.reason}${e.code ? ` ${e.code}` : ''}` : 'error';
    if (logId) await smsLogRepository.setStatus(logId, 'failed', { error: detail }).catch(() => {});
    throw e instanceof AppError ? e : new AppError('SMS_FAILED', { cause: e });
  }
}

export const smsService = {
  /** the login code; throws AppError SMS_FAILED. Returns the provider that sent it. */
  async sendOtp(phone: string, code: string): Promise<string> {
    const { provider, id } = await resolve();
    await logged({ phone, purpose: 'otp', provider: id }, () => provider.sendOtp(phone, code));
    return id;
  },

  /**
   * An order event's SMS, when the admin switched that event on and gave it a template. Never throws: an SMS problem must not
   * break the order flow. Returns what happened.
   */
  async sendEvent(
    event: SmsEventKey,
    phone: string,
    values: Partial<Record<SmsVariable, string | number>>,
    ctx: { userId?: string | null; orderId?: string | null } = {},
  ): Promise<'sent' | 'skipped' | 'failed'> {
    try {
      const all = await settingsRead.all();
      const template = all.get(`sms.event.${event}.template` as never) as string;
      if (all.get(`sms.event.${event}.enabled` as never) !== true || !template) return 'skipped';
      const { provider, id } = await resolve();
      await logged({ phone, purpose: event === 'shipped' ? 'shipping' : /^(topup|withdrawal)/.test(event) ? 'other' : 'order', provider: id, ...ctx }, () =>
        provider.sendTemplate(phone, template, paramsFor(event, values)),
      );
      return 'sent';
    } catch (e) {
      logger.warn('sms.event_failed', {
        event,
        to: maskMobile(phone),
        err: e instanceof Error ? e.message : 'unknown',
      });
      return 'failed';
    }
  },

  /**
   * The operator's alert about a stuck order: one template SMS with the order number, only when the admin saved both the
   * operator's number and the alert template. Never throws; the caller guarantees «once per order».
   */
  async sendOperatorAlert(orderNo: string, orderId: string): Promise<'sent' | 'skipped' | 'failed'> {
    try {
      const phone = await settingsRead.get('orders.operator_phone');
      const template = await settingsRead.get('sms.operator_template');
      if (!phone || !template) return 'skipped';
      const { provider, id } = await resolve();
      await logged({ phone, purpose: 'other', provider: id, orderId }, () =>
        provider.sendTemplate(phone, template, { order_no: orderNo }),
      );
      return 'sent';
    } catch (e) {
      logger.warn('sms.operator_alert_failed', {
        order: orderNo,
        err: e instanceof Error ? e.message : 'unknown',
      });
      return 'failed';
    }
  },

  /** «ارسال آزمایشی»: only to the signed-in admin's own number, 3 per 10 minutes; audited */
  async sendTest(meta: RequestMeta): Promise<{ ok: boolean; message: string; provider: string }> {
    const admin = await authorize('admin');
    rateLimit(`sms-test:${admin.id}`, 3, 600_000);
    let result: { ok: boolean; message: string; provider: string };
    try {
      const { provider, id } = await resolve();
      const code = String(10_000 + Math.floor(Math.random() * 90_000));
      await logged({ phone: admin.phone, purpose: 'other', provider: id, userId: admin.id }, () =>
        provider.sendOtp(admin.phone, code),
      );
      result = {
        ok: true,
        provider: id,
        message: `پیامک آزمایشی به ${maskMobile(admin.phone)} فرستاده شد${SMS_PROVIDERS[id].verified ? '' : ' (این سرویس هنوز تأییدنشده است)'}.`,
      };
    } catch (e) {
      result = {
        ok: false,
        provider: 'unknown',
        message:
          e instanceof AppError && e.code === 'SMS_FAILED'
            ? 'ارسال انجام نشد: کلید، الگو یا آدرس سرویس را بررسی کنید.'
            : (e as Error).message,
      };
    }
    await auditRepository.record({
      actorUserId: admin.id,
      action: 'sms.test',
      entityType: 'setting',
      entityId: 'sms',
      meta: { ok: result.ok, provider: result.provider },
      ip: meta.ip,
    });
    return result;
  },
};

export { SMS_EVENTS };
