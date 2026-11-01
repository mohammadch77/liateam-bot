import { HttpFailure, postJson, type FetchLike } from '../http/post-json.ts';
import { SmsError, type SmsCredentials, type SmsProvider, type SmsSendResult } from './types.ts';

/**
 * Kavenegar «verify/lookup»: sends a pre-approved template (delivered fast, even to numbers that block promotional SMS).
 * https://kavenegar.com/rest.html#sms-Lookup  The API key is part of the URL path, so the URL is never logged or put in an
 * error. A template takes up to three tokens (token, token2, token3): the event's variables in order.
 * Verified in production use (login codes); the template call for order events uses the same endpoint.
 */
export const KAVENEGAR_VERIFIED = true;

export function kavenegarProvider(c: SmsCredentials): SmsProvider {
  const f = c.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const endpoint = `https://api.kavenegar.com/v1/${encodeURIComponent(c.apiKey)}/verify/lookup.json`;

  async function lookup(mobile: string, template: string, tokens: string[]): Promise<SmsSendResult> {
    if (!c.apiKey) throw new SmsError('misconfigured', 'no api key');
    if (!template) throw new SmsError('misconfigured', 'no template');
    const body: Record<string, string> = { receptor: mobile, template, token: tokens[0] ?? '' };
    if (tokens[1] !== undefined) body.token2 = tokens[1];
    if (tokens[2] !== undefined) body.token3 = tokens[2];
    let r;
    try {
      r = await postJson(f, endpoint, body, { form: true, timeoutMs: 8000 });
    } catch (e) {
      if (e instanceof HttpFailure)
        throw new SmsError(e.kind === 'timeout' ? 'timeout' : 'unreachable', `kavenegar ${e.kind}`);
      throw e;
    }
    const j = r.json as { return?: { status?: number }; entries?: Array<{ messageid?: number }> } | null;
    if (r.status === 200 && j?.return?.status === 200)
      return { providerRef: String(j.entries?.[0]?.messageid ?? '') };
    // e.g. 411 invalid receptor, 418 low credit, 424 template not found, 431 bad token
    throw new SmsError('rejected', 'kavenegar refused the message', j?.return?.status ?? r.status);
  }

  return {
    id: 'kavenegar',
    sendOtp: (mobile, code) => lookup(mobile, c.otpTemplate ?? '', [code]),
    sendTemplate: (mobile, key, params) => lookup(mobile, key, Object.values(params)),
  };
}
