import { devSmsProvider } from './dev.ts';
import { IPPANEL_VERIFIED, ippanelProvider } from './ippanel.ts';
import { KAVENEGAR_VERIFIED, kavenegarProvider } from './kavenegar.ts';
import type { SmsCredentials, SmsProvider } from './types.ts';

/**
 * The SMS providers the admin can choose. Adding one = an adapter file implementing SmsProvider + an entry here.
 * 'env' (settings only, not a provider) means: keep using SMS_PROVIDER / KAVENEGAR_* from the server's .env, which is how
 * the shop worked before the panel could choose.
 */
export type SmsProviderId = 'dev' | 'kavenegar' | 'ippanel';
export const SMS_PROVIDERS: Record<
  SmsProviderId,
  {
    label: string;
    production: boolean;
    verified: boolean;
    needsEndpoint: boolean;
    create(c: SmsCredentials): SmsProvider;
  }
> = {
  dev: {
    label: 'آزمایشی (لاگ سرور)',
    production: false,
    verified: true,
    needsEndpoint: false,
    create: devSmsProvider,
  },
  kavenegar: {
    label: 'کاوه‌نگار',
    production: true,
    verified: KAVENEGAR_VERIFIED,
    needsEndpoint: false,
    create: kavenegarProvider,
  },
  ippanel: {
    label: 'فراز اس‌ام‌اس (ippanel)',
    production: true,
    verified: IPPANEL_VERIFIED,
    needsEndpoint: true,
    create: ippanelProvider,
  },
};
export const SMS_PROVIDER_IDS = Object.keys(SMS_PROVIDERS) as SmsProviderId[];

/** The dev provider is refused in production, whatever the settings say. */
export function createSmsProvider(id: SmsProviderId, c: SmsCredentials, isProduction: boolean): SmsProvider {
  const p = SMS_PROVIDERS[id];
  if (!p) throw new Error(`unknown sms provider ${id}`);
  if (isProduction && !p.production) throw new Error(`sms provider "${id}" is not allowed in production`);
  return p.create(c);
}
