import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { maskMobile } from '@/lib/phone';
import type { SmsProvider } from './types';

const TIMEOUT_MS = 8000;

/**
 * Kavenegar «verify/lookup»: sends a pre-approved template, which is delivered fast and even to numbers that
 * block promotional SMS. The API key is part of the URL path, so the URL is never logged.
 * https://kavenegar.com/rest.html#sms-Lookup
 */
export function kavenegarProvider(apiKey: string, template: string): SmsProvider {
  const endpoint = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/verify/lookup.json`;
  return {
    name: 'kavenegar',
    async sendOtp(phone, code) {
      let status: number | undefined;
      let returnStatus: number | undefined;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ receptor: phone, token: code, template }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: 'no-store',
        });
        status = res.status;
        const body = (await res.json().catch(() => null)) as { return?: { status?: number } } | null;
        returnStatus = body?.return?.status;
        if (res.ok && returnStatus === 200) return;
      } catch (e) {
        logger.error('sms.kavenegar.request_failed', { to: maskMobile(phone), err: e });
        throw new AppError('SMS_FAILED', { cause: e });
      }
      // e.g. 411 invalid receptor, 418 low credit, 424 template not found, 431 bad token
      logger.error('sms.kavenegar.rejected', {
        to: maskMobile(phone),
        http: status,
        kavenegarStatus: returnStatus,
      });
      throw new AppError('SMS_FAILED');
    },
  };
}
