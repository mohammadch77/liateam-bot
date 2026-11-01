import { PaymentError, type GatewayCredentials, type PaymentGateway } from './types.ts';

/**
 * The simulator for staging and development: no network. `request` hands back a redirect that already carries the outcome
 * the tester picked (success / failed / canceled), and `verify` reads it from the returning query. Never allowed in
 * production (registry.ts refuses it).
 */
export type DevOutcome = 'success' | 'failed' | 'canceled';

export function devGateway(_c: GatewayCredentials, outcome: DevOutcome = 'success'): PaymentGateway {
  return {
    id: 'dev',
    async request(r) {
      if (!Number.isSafeInteger(r.amount) || r.amount <= 0)
        throw new PaymentError('invalid_amount', 'amount must be a positive whole toman');
      const authority =
        `DEV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
      const sep = r.callbackUrl.includes('?') ? '&' : '?';
      const status = outcome === 'canceled' ? 'NOK' : 'OK';
      return {
        authority,
        redirectUrl: `${r.callbackUrl}${sep}Authority=${authority}&Status=${status}&sim=${outcome}`,
      };
    },
    async verify(v) {
      const sim = v.query.sim ?? (v.query.Status === 'NOK' ? 'canceled' : 'success');
      if (sim === 'canceled' || v.query.Status === 'NOK')
        return { ok: false, outcome: 'canceled', raw: { sim } };
      if (sim === 'failed') return { ok: false, outcome: 'failed', raw: { sim } };
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
