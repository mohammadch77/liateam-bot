// Minimal Bot API client. Telegram and Bale speak the same protocol (Bale: tapi.bale.ai).
// Tokens come only from .env and never appear in errors or logs.
import { fetch, ProxyAgent } from 'undici';

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
  const dispatcher = p.proxy ? new ProxyAgent(p.proxy) : undefined;
  async function call(method, params = {}, timeoutMs = 20_000) {
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
