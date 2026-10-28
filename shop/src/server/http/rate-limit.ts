import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * A small fixed-window limiter for actions that are cheap to repeat (cart changes, address saves, live checks): at most
 * `max` calls per `windowMs` for one key (a user id, a cart hash or an IP). It lives in this server process — enough for
 * one app instance; the OTP limits (which matter for money) are in the database.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number, now: number = Date.now()): void {
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > max) {
    logger.warn('security.rate_limited', { bucket: key.split(':')[0] });
    throw new AppError('RATE_LIMITED');
  }
}
