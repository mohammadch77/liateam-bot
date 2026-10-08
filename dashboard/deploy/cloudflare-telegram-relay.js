// Cloudflare Worker: lets a server in Iran reach the Telegram Bot API.
// 1. Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file → Deploy.
// 2. Settings → Variables: add BOT_ID = the number before ":" in your bot token (e.g. 7123456789).
// 3. Settings → Domains & Routes → Custom domain: e.g. tg.yourdomain.com  (*.workers.dev is filtered in Iran).
// 4. On the server, in .env:  TELEGRAM_API_BASE=https://tg.yourdomain.com
// Only YOUR bot's requests are forwarded; anything else gets 404, so it is not an open proxy.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.BOT_ID || !url.pathname.startsWith(`/bot${env.BOT_ID}:`)) return new Response('Not found', { status: 404 });
    return fetch(`https://api.telegram.org${url.pathname}${url.search}`, {
      method: request.method,
      headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    });
  },
};
