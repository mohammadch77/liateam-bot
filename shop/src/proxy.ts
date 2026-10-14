import { NextResponse, type NextRequest } from 'next/server';
import { SEARCH_HEADER } from '@/lib/internal-headers';

/**
 * Layouts cannot read the query string, but the canonical-URL redirect in /c/[slug] and /p/[slug] layouts must
 * keep it (an old link with ?sort=…&page=2 should land on the same filtered view). This passes it along in an
 * internal request header. Any client-sent value of that header is overwritten.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(SEARCH_HEADER, request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/c/:path*', '/p/:path*'] };
