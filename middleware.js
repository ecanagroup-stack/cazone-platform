import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { STAFF_ROLES } from '@/lib/permissions';

/**
 * Server-side route protection (defense-in-depth; per-page/API permission checks happen further
 * downstream too).
 * - `/platform/*` — the super_admin (Cazone operator) only, spans every organization.
 * - `/admin/*` — any staff role (owner/manager/staff) within their own organization.
 * - `/portal/*` — a `customer`-role login (fuel credit client / shop registered customer) only.
 * - `/api/*` mirrors the same three gates for `/api/platform/*`, `/api/admin/*`, `/api/portal/*`.
 */
export default async function middleware(request) {
  const { pathname } = request.nextUrl;
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (pathname.startsWith('/platform')) {
    if (!token || token.role !== 'super_admin') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/admin')) {
    if (!token || !STAFF_ROLES.includes(token.role)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/portal')) {
    if (!token || token.role !== 'customer') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/api') && !pathname.startsWith('/api/auth')) {
    if (pathname.startsWith('/api/platform')) {
      if (!token || token.role !== 'super_admin') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.next();
    }
    if (pathname.startsWith('/api/admin')) {
      if (!token || !STAFF_ROLES.includes(token.role)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.next();
    }
    if (pathname.startsWith('/api/portal')) {
      if (!token || token.role !== 'customer') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/platform/:path*', '/admin/:path*', '/portal/:path*', '/api/:path*'],
};
