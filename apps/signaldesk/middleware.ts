import { auth } from '@/lib/auth/middleware-auth';
import { NextResponse } from 'next/server';

const publicPaths = new Set([
  '/',
  '/features',
  '/pricing',
  '/privacy',
  '/terms',
  '/sign-in',
  '/sign-up',
]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    publicPaths.has(pathname) ||
    pathname.startsWith('/api/auth') ||
    pathname === '/api/register' ||
    pathname === '/api/health' ||
    pathname.startsWith('/_next');

  if (isPublic) {
    return NextResponse.next();
  }

  if (!req.auth?.user?.id) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};