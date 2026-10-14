import 'server-only';
import { getConfig } from '@/lib/config';
import { devSmsProvider } from './dev';
import { kavenegarProvider } from './kavenegar';
import type { SmsProvider } from './types';

export type { SmsProvider };

let provider: SmsProvider | undefined;

/** The provider chosen by SMS_PROVIDER. Adding a gateway = one file implementing SmsProvider + a case here. */
export function getSmsProvider(): SmsProvider {
  if (provider) return provider;
  const c = getConfig();
  switch (c.SMS_PROVIDER) {
    case 'kavenegar':
      // presence is guaranteed by the config cross-check
      provider = kavenegarProvider(c.KAVENEGAR_API_KEY ?? '', c.KAVENEGAR_OTP_TEMPLATE ?? '');
      break;
    case 'dev':
      provider = devSmsProvider;
      break;
  }
  return provider;
}
