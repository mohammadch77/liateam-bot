import { HttpFailure, postJson, type FetchLike } from '../http/post-json.ts';
import {
  PaymentError,
  tomanToRial,
  type GatewayCredentials,
  type PaymentGateway,
  type PaymentVerified,
} from './types.ts';

/**
 * Zarinpal (API v4). Endpoints, fields and codes follow ZarinPal's official guide
 * (https://www.zarinpal.com/docs/paymentGateway/connectToGateway): request -> data.authority (code 100), the buyer is
 * sent to StartPay/<authority>, comes back with ?Authority=...&Status=OK|NOK, and verify answers code 100 (first time) or
 * 101 (already verified). The amount is in RIAL, converted here from toman.
 *
 * UNVERIFIED: written from the documentation, never run against the real service. The SANDBOX host (sandbox.zarinpal.com)
 * comes from third-party SDKs, not from an official page. Before going live run one real small payment (sandbox first)
 * end to end. TODO(D): confirm the sandbox StartPay URL and merchant id with ZarinPal.
 */
export const ZARINPAL_VERIFIED = false;

const HOSTS = {
  live: {
    api: 'https://payment.zarinpal.com/pg/v4/payment',
    pay: 'https://payment.zarinpal.com/pg/StartPay',
  },
  sandbox: {
    api: 'https://sandbox.zarinpal.com/pg/v4/payment',
    pay: 'https://sandbox.zarinpal.com/pg/StartPay',
  },
} as const;

const MERCHANT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
type Data = { code?: number; authority?: string; ref_id?: number | string; card_pan?: string };
type Envelope = { data?: Data | []; errors?: { code?: number; message?: string } | [] };

export function zarinpalGateway(c: GatewayCredentials): PaymentGateway {
  const hosts = c.sandbox ? HOSTS.sandbox : HOSTS.live;
  const f = c.fetch ?? (globalThis.fetch as unknown as FetchLike);

  async function call(path: string, body: Record<string, unknown>): Promise<Envelope> {
    try {
      const r = await postJson(f, `${hosts.api}/${path}`, { merchant_id: c.merchantId, ...body });
      return (r.json ?? {}) as Envelope;
    } catch (e) {
      if (e instanceof HttpFailure)
        throw new PaymentError(e.kind === 'timeout' ? 'timeout' : 'unreachable', `gateway ${e.kind}`);
      throw e;
    }
  }
  const data = (e: Envelope): Data | null => (e.data && !Array.isArray(e.data) ? e.data : null);
  const errCode = (e: Envelope) => (e.errors && !Array.isArray(e.errors) ? e.errors.code : undefined);

  return {
    id: 'zarinpal',
    async request(r) {
      const res = await call('request.json', {
        amount: tomanToRial(r.amount),
        callback_url: r.callbackUrl,
        description: r.description.slice(0, 200),
        metadata: { ...(r.mobile ? { mobile: r.mobile } : {}), order_id: r.orderNo },
      });
      const d = data(res);
      if (d?.code === 100 && d.authority)
        return { authority: d.authority, redirectUrl: `${hosts.pay}/${d.authority}` };
      if (!d && errCode(res) === undefined)
        throw new PaymentError('bad_response', 'unexpected gateway answer');
      throw new PaymentError('rejected', 'gateway refused the request', errCode(res) ?? d?.code);
    },
    async verify(v) {
      if (v.query.Status === 'NOK') return { ok: false, outcome: 'canceled', raw: { status: 'NOK' } };
      const rial = tomanToRial(v.amount);
      let res: Envelope;
      try {
        res = await call('verify.json', { amount: rial, authority: v.authority });
      } catch (e) {
        if (e instanceof PaymentError) return { ok: false, outcome: 'error', raw: { error: e.reason } };
        throw e;
      }
      const d = data(res);
      if (d && (d.code === 100 || d.code === 101)) {
        const out: PaymentVerified = {
          ok: true,
          outcome: 'paid',
          refId: d.ref_id !== undefined ? String(d.ref_id) : undefined,
          cardMasked: d.card_pan,
          raw: { code: d.code },
        };
        return out;
      }
      return { ok: false, outcome: 'failed', raw: { code: errCode(res) ?? d?.code ?? null } };
    },
    selfCheck() {
      if (!c.merchantId) return { ok: false, message: 'شناسه‌ی پذیرنده هنوز وارد نشده است.' };
      if (!MERCHANT.test(c.merchantId))
        return { ok: false, message: 'شناسه‌ی پذیرنده باید ۳۶ نویسه (قالب UUID) باشد.' };
      return {
        ok: true,
        message: `قالب شناسه‌ی پذیرنده درست است (${c.sandbox ? 'سندباکس' : 'واقعی'}). اتصال واقعی بدون تراکنش آزمایش نمی‌شود.`,
      };
    },
  };
}
