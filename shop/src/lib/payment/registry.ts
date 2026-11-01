import { devGateway } from './dev.ts';
import type { GatewayCredentials, PaymentGateway } from './types.ts';
import { ZARINPAL_VERIFIED, zarinpalGateway } from './zarinpal.ts';

/**
 * The payment providers the admin can choose. Adding a gateway (IDPay, NextPay, Sadad ...) = one adapter file implementing
 * PaymentGateway + one entry here; the settings, the secret fields and the engine need no change.
 */
export type PaymentProviderId = 'dev' | 'zarinpal';
export const PAYMENT_PROVIDERS: Record<
  PaymentProviderId,
  { label: string; production: boolean; verified: boolean; create(c: GatewayCredentials): PaymentGateway }
> = {
  dev: { label: 'شبیه‌ساز (فقط آزمایشی)', production: false, verified: true, create: (c) => devGateway(c) },
  zarinpal: { label: 'زرین‌پال', production: true, verified: ZARINPAL_VERIFIED, create: zarinpalGateway },
};
export const PAYMENT_PROVIDER_IDS = Object.keys(PAYMENT_PROVIDERS) as PaymentProviderId[];

/** The dev simulator is refused in production, whatever the settings say. */
export function createGateway(
  id: PaymentProviderId,
  c: GatewayCredentials,
  isProduction: boolean,
): PaymentGateway {
  const p = PAYMENT_PROVIDERS[id];
  if (!p) throw new Error(`unknown payment provider ${id}`);
  if (isProduction && !p.production) throw new Error(`payment provider "${id}" is not allowed in production`);
  return p.create(c);
}
