import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getCsrfTokenFromCookie, getCsrfTokenFromHeader, needsCsrfValidation, validateCsrfToken } from '@/lib/auth/csrf';

const JWT_SECRET_ENV = process.env['JWT_SECRET'];
const JWT_SECRET = JWT_SECRET_ENV ? new TextEncoder().encode(JWT_SECRET_ENV) : null;

const PUBLIC_PATHS = [
  '/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/reset-password',
  '/auth/verify-email', '/auth/callback', '/auth/invite', '/health', '/docs',
  '/', '/setup', '/lead-capture', '/test-js', '/auth/login-simple',
  '/portal', '/portal/tickets', '/portal/invoices', '/portal/kb',
  '/api/auth/login', '/api/auth/signup', '/api/auth/logout',
  '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email',
  '/api/auth/resend-verification', '/api/auth/accept-invite', '/api/auth/invite-details',
  '/api/auth/2fa/setup', '/api/auth/2fa/verify', '/api/auth/2fa/disable',
  '/api/auth/sso/start', '/api/auth/sso/callback', '/api/auth/sso/discover',
  '/api/forms/submit', '/api/leads/public',
  '/api/webhooks/stripe', '/api/webhooks/resend', '/api/webhooks/whatsapp', '/api/webhooks/inbound',
  '/api/health', '/api/track/click', '/api/track/open', '/api/unsubscribe',
  '/api/keepalive', '/api/test-email', '/api/cron', '/api/metrics', '/api/embed',
  '/api/setup/check', '/api/setup/create-admin', '/api/lead-capture', '/api/lead-capture/submit',
  '/api/public/tickets', '/api/public/invoices', '/api/public/kb',
  '/sw.js', '/manifest.json',
];

const PUBLIC_PREFIXES = ['/_next', '/favicon', '/images', '/static', '/icons'];

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] || 'http://localhost:3000').split(',').map(s => s.trim());

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) return true;
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return true;
  return false;
}

function setCORS(response: NextResponse, origin: string | null, pathname: string): void {
  if (!pathname.startsWith('/api/')) return;
  const allowed = origin && ALLOWED_ORIGINS.some(ao => {
    if (ao === '*') return true;
    if (ao.startsWith('*.')) return origin.endsWith(ao.slice(1));
    return ao === origin;
  });
  response.headers.set('Access-Control-Allow-Origin', allowed ? origin : (ALLOWED_ORIGINS[0] || '*'));
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, x-cron-secret, x-auth-method');
  response.headers.set('Vary', 'Origin');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');

  // CORS preflight
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    setCORS(response, origin, pathname);
    if (origin && ALLOWED_ORIGINS.some(ao => ao === '*' || ao === origin)) {
      response.headers.set('Access-Control-Max-Age', '86400');
    }
    return response;
  }

  // Public paths pass through with CORS
  if (isPublic(pathname)) {
    const response = NextResponse.next();
    setCORS(response, origin, pathname);
    return response;
  }

  // Auth check for protected paths
  if (!JWT_SECRET) {
    const response = NextResponse.next();
    setCORS(response, origin, pathname);
    return response;
  }

  const cookieToken = request.cookies.get('nucrm_session')?.value;
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const url = new URL('/auth/login', request.url);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub) throw new Error('Invalid token');

    // CSRF protection for state-changing API requests
    const authMethod = request.headers.get('x-auth-method') || undefined;
    if (pathname.startsWith('/api/') && needsCsrfValidation(request.method, pathname, authMethod)) {
      const cookieCsrf = getCsrfTokenFromCookie(request.headers.get('cookie') || null);
      const headerCsrf = getCsrfTokenFromHeader(request.headers);
      if (!validateCsrfToken(cookieCsrf, headerCsrf)) {
        return NextResponse.json({ error: 'CSRF token missing or invalid' }, { status: 403 });
      }
    }

    const response = NextResponse.next();
    setCORS(response, origin, pathname);
    return response;
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
