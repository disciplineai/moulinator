import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/dashboard', '/credentials', '/repos', '/runs', '/contribute'];

// Baked at build time. When mocks are on, the app produces a synthetic user and
// protected routes must not be gated at the edge.
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === '1';

export function middleware(req: NextRequest) {
  if (USE_MOCKS) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const session = req.cookies.get('moulinator_session')?.value;
  const hasSession = Boolean(session);

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  // Note: we deliberately do NOT redirect away from /login or /signup when the
  // marker cookie is present. The cookie can outlive the in-memory session (e.g.
  // after a reload before the refresh-cookie bootstrap has a chance to run),
  // and a user who lands on /login should always be able to reach the form.
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/credentials/:path*', '/repos/:path*', '/runs/:path*', '/contribute/:path*'],
};
