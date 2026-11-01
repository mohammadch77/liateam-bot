import { HttpFailure, postJson, type FetchLike } from '../http/post-json.ts';
import { SmsError, type SmsCredentials, type SmsProvider, type SmsSendResult } from './types.ts';

/**
 * Faraz SMS / Ippanel, «pattern» sending: POST <endpoint>/api/send with
 * { sending_type: 'pattern', from_number, code, recipients: ['+98...'], params } and the API token in Authorization;
 * success = meta.status true. That is what the provider's public documentation shows
 * (https://ippanelcom.github.io/Edge-Document/docs/send/pattern).
 *
 * UNVERIFIED: the documentation names no concrete host ("{base_url}") and is unclear whether the token is sent as-is or as
 * "API <token>", so the host is NOT guessed: the admin enters it (setting sms.endpoint) and the header carries the token as
 * given. Never run against the real service. TODO(D): confirm host + Authorization format with Ippanel, then send one
 * real pattern message.
 */
export const IPPANEL_VERIFIED = false;

/** 09121234567 -> +989121234567 */
export const toE164 = (mobile: string): string => `+98${mobile.replace(/^0/, '')}`;

export function ippanelProvider(c: SmsCredentials): SmsProvider {
  const f = c.fetch ?? (globalThis.fetch as unknown as FetchLike);

  async function pattern(
    mobile: string,
    code: string,
    params: Record<string, string>,
  ): Promise<SmsSendResult> {
    if (!c.apiKey) throw new SmsError('misconfigured', 'no api key');
    if (!c.endpoint) throw new SmsError('misconfigured', 'no endpoint');
    if (!c.sender) throw new SmsError('misconfigured', 'no sender line');
    if (!code) throw new SmsError('misconfigured', 'no pattern code');
    let r;
    try {
      r = await postJson(
        f,
        `${c.endpoint.replace(/\/$/, '')}/api/send`,
        { sending_type: 'pattern', from_number: c.sender, code, recipients: [toE164(mobile)], params },
        { headers: { Authorization: c.apiKey }, timeoutMs: 8000 },
      );
    } catch (e) {
      if (e instanceof HttpFailure)
        throw new SmsError(e.kind === 'timeout' ? 'timeout' : 'unreachable', `ippanel ${e.kind}`);
      throw e;
    }
    const j = r.json as {
      data?: { message_outbox_ids?: unknown[] };
      meta?: { status?: boolean; message_code?: string };
    } | null;
    if (j?.meta?.status === true) return { providerRef: String(j.data?.message_outbox_ids?.[0] ?? '') };
    throw new SmsError('rejected', 'ippanel refused the message', r.status);
  }

  return {
    id: 'ippanel',
    sendOtp: (mobile, code) => pattern(mobile, c.otpTemplate ?? '', { code }),
    sendTemplate: (mobile, key, params) => pattern(mobile, key, params),
  };
}
