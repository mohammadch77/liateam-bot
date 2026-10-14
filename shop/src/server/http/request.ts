import 'server-only';
import { headers } from 'next/headers';
import { isIP } from 'node:net';
import { getConfig } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export type RequestMeta = { ip: string | null; userAgent: string | null };

/**
 * Client IP and user agent. The IP is only trusted from nginx (X-Real-IP) when TRUST_PROXY is on; otherwise a
 * client could forge it to dodge the per-IP rate limit. Without a proxy (local dev) the IP is unknown (null).
 */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const raw = getConfig().TRUST_PROXY ? h.get('x-real-ip')?.trim() : undefined;
  const ip = raw && isIP(raw) ? raw : null;
  const ua = h.get('user-agent');
  return { ip, userAgent: ua ? ua.slice(0, 512) : null };
}

/**
 * CSRF defence for every mutation (in addition to SameSite=Lax cookies and Next.js' own Server Action
 * Origin check): the browser-sent Origin must match the host the request came to.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  let ok = false;
  try {
    ok = !!origin && !!host && new URL(origin).host === host;
  } catch {
    ok = false;
  }
  if (!ok) {
    logger.warn('security.csrf_rejected', { origin, host });
    throw new AppError('CSRF');
  }
}
