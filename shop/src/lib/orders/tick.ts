import { timingSafeEqual } from 'node:crypto';

/**
 * The background tick's rules, pure (no database, no clock but the one passed in): who may call it, how a batch of orders is
 * walked (a limit, a time budget, one order's failure never stops the rest, an order someone else is advancing is skipped),
 * and when a waiting order counts as stuck.
 */

/** Same-length constant-time comparison of the shared secret. */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The tick is for the machine itself. nginx puts the visitor's address in X-Real-IP / X-Forwarded-For on EVERY request it
 * forwards, while the tick script talks to the app directly and sends neither: so a request carrying a non-loopback address
 * in either header came from outside and is refused.
 */
export function isLocalRequest(h: { get(name: string): string | null }): boolean {
  for (const name of ['x-real-ip', 'x-forwarded-for']) {
    const v = h.get(name);
    if (v === null || v.trim() === '') continue;
    if (!v.split(',').every((p) => LOOPBACK.has(p.trim()))) return false;
  }
  return true;
}

/** Secret configured, sent in `x-cron-secret`, equal; and the request is local. Anything else is «not found». */
export function tickAllowed(secret: string | undefined, h: { get(name: string): string | null }): boolean {
  if (!secret) return false;
  const given = h.get('x-cron-secret') ?? '';
  return given !== '' && sameSecret(given, secret) && isLocalRequest(h);
}

export type TickOrder = { id: string; number: string };
export type TickResult = {
  tried: number;
  advanced: number;
  skipped: number;
  failed: number;
  /** the id to continue from next time (null = the end of the list was reached) */
  cursor: string | null;
  stoppedBy: 'done' | 'limit' | 'budget';
};

/**
 * Walks `orders` in order. `advance` returns false when the order was locked by someone else (skipped), true when it ran; a
 * throw is counted and logged by `onError` (the order number only) and the walk goes on. Stops at `limit` orders or when
 * `budgetMs` has passed (checked before each order).
 */
export async function runTick(opts: {
  orders: readonly TickOrder[];
  advance: (o: TickOrder) => Promise<boolean>;
  limit: number;
  budgetMs: number;
  now?: () => number;
  onError?: (o: TickOrder, e: unknown) => void;
}): Promise<TickResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const r: TickResult = { tried: 0, advanced: 0, skipped: 0, failed: 0, cursor: null, stoppedBy: 'done' };
  for (const o of opts.orders) {
    if (r.tried >= opts.limit) {
      r.stoppedBy = 'limit';
      break;
    }
    if (now() - started >= opts.budgetMs) {
      r.stoppedBy = 'budget';
      break;
    }
    r.tried += 1;
    r.cursor = o.id;
    try {
      if (await opts.advance(o)) r.advanced += 1;
      else r.skipped += 1;
    } catch (e) {
      r.failed += 1;
      opts.onError?.(o, e);
    }
  }
  if (r.stoppedBy === 'done') r.cursor = null;
  return r;
}

/** An order paid before this moment and still waiting to be registered is stuck. */
export const stuckCutoff = (minutes: number, now: Date): Date => new Date(now.getTime() - minutes * 60_000);
