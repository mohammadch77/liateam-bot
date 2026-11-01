import { maskMobile } from '../phone.mjs';
import { SmsError, type SmsCredentials, type SmsProvider } from './types.ts';

/**
 * Development provider: sends nothing, prints to the log (the login code too, so it can be typed in locally; no template
 * text). Refused in production (registry.ts).
 */
export function devSmsProvider(c: Pick<SmsCredentials, 'log'> = {}): SmsProvider {
  const log = c.log ?? (() => {});
  return {
    id: 'dev',
    async sendOtp(mobile, code) {
      log({ event: 'sms.dev.otp', to: maskMobile(mobile), devCode: code });
      return { providerRef: 'dev' };
    },
    async sendTemplate(mobile, templateKey, params) {
      if (!templateKey) throw new SmsError('misconfigured', 'no template');
      log({
        event: 'sms.dev.template',
        to: maskMobile(mobile),
        template: templateKey,
        vars: Object.keys(params),
      });
      return { providerRef: 'dev' };
    },
  };
}
