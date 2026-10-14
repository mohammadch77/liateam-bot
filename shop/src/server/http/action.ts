import 'server-only';
import { toAppError, type ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertSameOrigin } from './request';

/** What a form action returns to the browser: data the UI renders, or a safe Persian error message. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; error: string };

/**
 * Every mutating Server Action goes through here: same-origin (CSRF) check first, then the work; any error
 * becomes a user-safe message (internal details are logged, never returned).
 */
export async function runAction<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    await assertSameOrigin();
    return { ok: true, data: await fn() };
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'INTERNAL') logger.error('action.failed', { action: name, err: e });
    return { ok: false, code: err.code, error: err.message };
  }
}
