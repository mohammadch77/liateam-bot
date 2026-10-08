// Nothing but the login page and static assets is reachable without a valid session cookie.
import { NextResponse } from 'next/server';
import { COOKIE, verifySession } from './lib/session';

export async function proxy(req) {
  const user = await verifySession(req.cookies.get(COOKIE)?.value);
  if (req.nextUrl.pathname === '/login') {
    return user ? NextResponse.redirect(new URL('/', req.url)) : NextResponse.next();
  }
  if (user) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) return new NextResponse('Unauthorized', { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
