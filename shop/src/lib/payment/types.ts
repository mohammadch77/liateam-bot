import type { FetchLike } from '../http/post-json.ts';

/**
 * Any online payment gateway. Amounts are ALWAYS whole toman here; an adapter converts to rial when its gateway wants rial
 * (never anywhere else). The adapters take their credentials as arguments: they read no setting and no environment, so
 * they are unit-tested with a fake HTTP and a new gateway is exactly one adapter file + one line in registry.ts.
 */
export type PaymentRequest = {
  /** toman, a positive integer */
  amount: number;
  orderNo: string;
  callbackUrl: string;
  description: string;
  /** canonical 09XXXXXXXXX */
  mobile?: string;
};
export type PaymentStarted = { authority: string; redirectUrl: string };

export type PaymentVerify = {
  authority: string;
  /** toman: what the order is worth; the gateway is asked to confirm exactly this */
  amount: number;
  /** the query string the gateway sent the buyer back with (Authority, Status ...) */
  query: Record<string, string | undefined>;
};
export type PaymentVerified = {
  ok: boolean;
  /** the bank / gateway reference of a successful payment */
  refId?: string;
  /** e.g. 6037-99xx-xxxx-1234 */
  cardMasked?: string;
  /** 'canceled' = the buyer backed out; 'failed' = the gateway refused; 'error' = we could not ask */
  outcome: 'paid' | 'canceled' | 'failed' | 'error';
  /** what the gateway said, WITHOUT credentials (safe to store in a log) */
  raw: Record<string, unknown>;
};

export type GatewayCredentials = {
  merchantId: string;
  apiKey?: string;
  sandbox: boolean;
  fetch?: FetchLike;
};

export interface PaymentGateway {
  readonly id: string;
  request(r: PaymentRequest): Promise<PaymentStarted>;
  verify(v: PaymentVerify): Promise<PaymentVerified>;
  /** Harmless validation of the saved credentials (format only: no network, no transaction). */
  selfCheck(): { ok: boolean; message: string };
}

export class PaymentError extends Error {
  readonly reason: 'invalid_amount' | 'rejected' | 'unreachable' | 'timeout' | 'bad_response';
  readonly code?: number;
  constructor(reason: PaymentError['reason'], message: string, code?: number) {
    super(message);
    this.name = 'PaymentError';
    this.reason = reason;
    this.code = code;
  }
}

export const tomanToRial = (toman: number): number => {
  if (!Number.isSafeInteger(toman) || toman <= 0)
    throw new PaymentError('invalid_amount', 'amount must be a positive whole toman');
  return toman * 10;
};
