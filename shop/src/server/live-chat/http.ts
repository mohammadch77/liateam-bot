import 'server-only';
import { toAppError } from '@/lib/errors';

export function chatJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function chatError(err: unknown): Response {
  const appErr = toAppError(err);
  const details =
    appErr.cause && typeof appErr.cause === 'object' && !(appErr.cause instanceof Error)
      ? appErr.cause
      : undefined;
  return Response.json(
    {
      ok: false,
      code: appErr.code,
      message: appErr.message,
      ...(details ? { details } : {}),
    },
    {
      status: appErr.status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export function readVisitorToken(request: Request): string | null {
  const fromHeader = request.headers.get('x-visitor-token');
  if (fromHeader) return fromHeader.trim();
  const url = new URL(request.url);
  return url.searchParams.get('token')?.trim() || null;
}

export function readClientIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip')?.trim() || null;
}
