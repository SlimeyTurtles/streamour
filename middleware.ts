import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Log API requests with timestamp
  if (pathname.startsWith('/api/')) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${request.method} ${pathname}`);
  }

  // Allow access to login page, auth API and the health check
  if (pathname === '/login' || pathname === '/api/health' || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Cheap first gate: no session cookie, no entry. The cookie's value is only
  // verified against the database by lib/auth.ts (getSession/requireSession),
  // which every data-returning route calls; the middleware can't do that.
  // Keep the name in sync with SESSION_COOKIE in lib/auth.ts.
  if (!request.cookies.get('session')?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
