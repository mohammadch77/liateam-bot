// Minimal Bot API client. Telegram and Bale speak the same protocol (Bale: tapi.bale.ai).
// Tokens come only from .env and never appear in errors or logs.
import { fetch, ProxyAgent, Agent } from 'undici';

const env = process.env;
export const PLATFORMS = {
  telegram: {
    label: 'تلگرام',
    token: env.TELEGRAM_BOT_TOKEN,
    // api.telegram.org is filtered in Iran: point this at your Cloudflare Worker relay (deploy/cloudflare-telegram-relay.js)
    base: (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, ''),
    proxy: env.TELEGRAM_PROXY,
  },
  bale: {
    label: 'بله',
    token: env.BALE_BOT_TOKEN,
    base: (env.BALE_API_BASE || 'https://tapi.bale.ai').replace(/\/$/, ''),
    proxy: env.BALE_PROXY,
  },
};

export class ApiError extends Error {}

export function createClient(name) {
  const p = PLATFORMS[name];
  // IPv4 only: on some servers IPv6 to Cloudflare is announced but does not work, and a request
  // that picks it just hangs until it times out (curl falls back to IPv4, Node does not).
  const dispatcher = p.proxy ? new ProxyAgent(p.proxy) : new Agent({ connect: { family: 4, timeout: 10_000 } });
  async function call(method, params = {}, timeoutMs = 20_000) {
    try {
      return await once(method, params, timeoutMs);
    } catch (e) {
      // One retry for sends that failed on the network (never for long polling).
      if (method === 'getUpdates' || !/network/.test(e.message)) throw e;
      return once(method, params, timeoutMs);
    }
  }
  async function once(method, params, timeoutMs) {
    let res;
    try {
      res = await fetch(`${p.base}/bot${p.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher,
      });
    } catch (e) {
      // e.message can contain the URL (with the token): keep only the kind of failure.
      throw new ApiError(`${method}: network ${e.cause?.code || e.name}`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new ApiError(`${method}: ${res.status} ${body.description || ''}`.trim());
    return body.result;
  }
  return { name, label: p.label, configured: Boolean(p.token), call };
}
