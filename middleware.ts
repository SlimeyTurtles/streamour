import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Log API requests with timestamp
  if (pathname.startsWith('/api/')) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${request.method} ${pathname}`);
  }

  // Allow access to login page, auth API, and media files
  if (pathname === '/login' || pathname.startsWith('/api/auth') || pathname.startsWith('/api/media')) {
    return NextResponse.next();
  }

  // Check for authentication cookie
  const authCookie = request.cookies.get('auth');

  if (!authCookie || authCookie.value !== 'authenticated') {
    // Redirect to login if not authenticated
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
