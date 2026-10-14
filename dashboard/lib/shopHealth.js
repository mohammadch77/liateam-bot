import 'server-only';

/**
 * Reads the shop's /health endpoints from inside the server (the shop listens on 127.0.0.1 only).
 * SHOP_HEALTH_URLS: comma-separated "label|url" pairs; defaults to staging (3850) and production (3849).
 */
const DEFAULT = 'استیجینگ|http://127.0.0.1:3850/health,سایت اصلی|http://127.0.0.1:3849/health';
const TIMEOUT_MS = 3000;

export function shopTargets() {
  return (process.env.SHOP_HEALTH_URLS || DEFAULT)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [label, url] = pair.includes('|') ? pair.split('|') : [pair, pair];
      return { label: label.trim(), url: url.trim() };
    });
}

/** One entry per target: state 'up' | 'degraded' | 'offline', with latency and the shop's own report. */
export async function getShopHealth() {
  return Promise.all(
    shopTargets().map(async ({ label, url }) => {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
        const ms = Math.round(performance.now() - t0);
        const body = await res.json().catch(() => null);
        const db = body?.checks?.database;
        return {
          label,
          state: res.ok && body?.status === 'ok' ? 'up' : 'degraded',
          ms,
          env: body?.env ?? null,
          dbStatus: db?.status ?? null,
          dbMs: db?.latencyMs ?? null,
          code: db?.code ?? (res.ok ? null : `HTTP ${res.status}`),
        };
      } catch {
        // Not running (e.g. production before launch) or not answering within the timeout.
        return { label, state: 'offline', ms: null, env: null, dbStatus: null, dbMs: null, code: null };
      }
    }),
  );
}
