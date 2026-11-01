import type { FetchLike } from '../http/post-json.ts';

/**
 * Any SMS gateway. Adapters take their credentials as arguments (no settings, no environment) and an injected fetch, so
 * they are unit-tested without a network. Failures throw SmsError (the reason, never the URL, key or text).
 */
export type SmsSendResult = { providerRef?: string };

export interface SmsProvider {
  readonly id: string;
  /** one-time login code; `mobile` is canonical 09XXXXXXXXX */
  sendOtp(mobile: string, code: string): Promise<SmsSendResult>;
  /** a pre-approved template of the provider; `params` keep the order of the event's variables */
  sendTemplate(mobile: string, templateKey: string, params: Record<string, string>): Promise<SmsSendResult>;
}

export type SmsCredentials = {
  apiKey: string;
  /** the sender line number (providers that need one) */
  sender?: string;
  /** the provider's template that carries the login code */
  otpTemplate?: string;
  /** providers without a fixed public host (see ippanel.ts) */
  endpoint?: string;
  fetch?: FetchLike;
  /** dev provider only: where the "sent" line goes */
  log?: (line: Record<string, unknown>) => void;
};

export class SmsError extends Error {
  readonly reason: 'rejected' | 'unreachable' | 'timeout' | 'misconfigured';
  readonly code?: number;
  constructor(reason: SmsError['reason'], message: string, code?: number) {
    super(message);
    this.name = 'SmsError';
    this.reason = reason;
    this.code = code;
  }
}
