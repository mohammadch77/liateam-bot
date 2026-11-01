import { PaymentError, type GatewayCredentials, type PaymentGateway } from './types.ts';

/**
 * The simulator for staging and development: no network. `request` sends the buyer to the shop's own simulator page
 * (/payment/simulator, which exists only outside production) where the tester picks paid / failed / canceled; that page
 * returns to the callback with the choice in `sim`, and `verify` reads it. Never allowed in production (registry.ts refuses
 * it; the page is a 404 there).
 */
export const DEV_SIMULATOR_PATH = '/payment/simulator';

export function devGateway(_c: GatewayCredentials): PaymentGateway {
  return {
    id: 'dev',
    async request(r) {
      if (!Number.isSafeInteger(r.amount) || r.amount <= 0)
        throw new PaymentError('invalid_amount', 'amount must be a positive whole toman');
      const authority =
        `DEV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
      const url = new URL(DEV_SIMULATOR_PATH, r.callbackUrl);
      url.searchParams.set('Authority', authority);
      return { authority, redirectUrl: url.toString() };
    },
    async verify(v) {
      const sim = v.query.sim ?? (v.query.Status === 'NOK' ? 'canceled' : 'failed');
      if (sim === 'canceled' || v.query.Status === 'NOK')
        return { ok: false, outcome: 'canceled', raw: { sim } };
      if (sim !== 'success') return { ok: false, outcome: 'failed', raw: { sim } };
      return {
        ok: true,
        refId: `SIM${v.authority.slice(-8)}`,
        cardMasked: '6037-99xx-xxxx-0000',
        outcome: 'paid',
        raw: { sim },
      };
    },
    selfCheck: () => ({ ok: true, message: 'درگاه آزمایشی (بدون شبکه) آماده است.' }),
  };
}
