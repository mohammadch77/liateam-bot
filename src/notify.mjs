// Telegram notifications via Bot API. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
// api.telegram.org is filtered in Iran: set TELEGRAM_PROXY (http://host:port) or point
// TELEGRAM_API_BASE at a relay you control.
import { fetch, ProxyAgent } from 'undici';
import { log } from './logger.mjs';

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const apiBase = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const proxy = process.env.TELEGRAM_PROXY || process.env.HTTPS_PROXY;
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

export const telegramConfigured = () => Boolean(token && chatId);

/** Sends a message; never throws (a broken notifier must not hide the sync result). Returns true on success. */
export async function notify(text) {
  if (!telegramConfigured()) {
    log.warn('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) - alert only logged');
    return false;
  }
  try {
    const res = await fetch(`${apiBase}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
      dispatcher,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      log.warn('Telegram send failed', { status: res.status, description: body.description });
      return false;
    }
    return true;
  } catch (e) {
    // Error text may contain the URL (with the token); keep only the error name/cause code.
    log.warn('Telegram unreachable', { error: e.name, cause: e.cause?.code });
    return false;
  }
}
