import 'server-only';
import { maskMobile } from '@/lib/phone';
import { logger } from '@/lib/logger';
import type { SmsProvider } from './types';

/**
 * Development provider: sends nothing, prints the code to the server log so it can be typed in locally.
 * Refused in production by config (SMS_PROVIDER=dev + APP_ENV=production fails at startup).
 */
export const devSmsProvider: SmsProvider = {
  name: 'dev',
  async sendOtp(phone, code) {
    logger.info('sms.dev.otp', { to: maskMobile(phone), devCode: code });
  },
};
