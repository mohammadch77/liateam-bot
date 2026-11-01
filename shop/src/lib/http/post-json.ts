/**
 * One HTTP call for the gateway adapters: POST, a hard timeout, JSON in and out. `fetchImpl` is injected so the tests
 * never touch the network. Errors say what failed, never the URL, headers or body (they can carry keys).
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    cache?: 'no-store';
  },
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export class HttpFailure extends Error {
  readonly kind: 'timeout' | 'network' | 'http';
  readonly status?: number;
  constructor(kind: 'timeout' | 'network' | 'http', status?: number) {
    super(kind === 'http' ? `HTTP ${status}` : kind);
    this.name = 'HttpFailure';
    this.kind = kind;
    this.status = status;
  }
}

export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  opts: { headers?: Record<string, string>; timeoutMs?: number; form?: boolean } = {},
): Promise<{ status: number; json: unknown }> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': opts.form ? 'application/x-www-form-urlencoded' : 'application/json',
        Accept: 'application/json',
        ...opts.headers,
      },
      body: opts.form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    throw new HttpFailure(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
}
