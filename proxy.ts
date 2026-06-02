import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getCsrfTokenFromCookie, getCsrfTokenFromHeader, needsCsrfValidation, validateCsrfToken } from '@/lib/auth/csrf';
import { edgeLimiter, getRateLimitHeaders, shouldBypassRateLimit } from '@/lib/rate-limit-edge';

const JWT_SECRET_ENV = process.env['JWT_SECRET'];
const JWT_SECRET = JWT_SECRET_ENV ? new TextEncoder().encode(JWT_SECRET_ENV) : null;

const RATE_LIMIT_UNAUTH = 30;
const RATE_LIMIT_AUTH = 120;
const RATE_LIMIT_API_KEY = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;

function generateRequestId(): string {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

const PUBLIC_PATHS = [
  '/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/reset-password',
  '/auth/verify-email', '/auth/callback', '/auth/invite', '/health', '/docs',
  '/', '/setup', '/lead-capture', '/test-js', '/auth/login-simple',
  '/portal', '/portal/tickets', '/portal/invoices', '/portal/kb',
  '/api/auth/login', '/api/auth/signup', '/api/auth/logout',
  '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email',
  '/api/auth/resend-verification', '/api/auth/accept-invite', '/api/auth/invite-details',
  '/api/auth/2fa/setup', '/api/auth/2fa/verify', '/api/auth/2fa/disable',
  '/api/auth/sso',
  '/api/forms/submit', '/api/leads/public',
  '/api/webhooks/stripe', '/api/webhooks/resend', '/api/webhooks/whatsapp', '/api/webhooks/inbound',
  '/api/health', '/api/track/click', '/api/track/open', '/api/unsubscribe',
  '/api/keepalive', '/api/test-email', '/api/cron', '/api/metrics', '/api/embed', '/api/emergency',
  '/api/setup/check', '/api/setup/create-admin', '/api/lead-capture', '/api/lead-capture/submit',
  '/api/public/tickets', '/api/public/invoices', '/api/public/kb', '/api/public/offers',
  '/sw.js', '/manifest.json',
];

const PUBLIC_PREFIXES = ['/_next', '/favicon', '/images', '/static', '/icons', '/api/v2'];

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

function applyRateLimitHeaders(response: NextResponse, result: { allowed: boolean; remaining: number; reset: number; limit: number }): void {
  const headers = getRateLimitHeaders(result);
  for (const [k, v] of Object.entries(headers)) {
    response.headers.set(k, v);
  }
}

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function buildRateLimitResponse(requestId: string, result: { allowed: boolean; remaining: number; reset: number; limit: number }, origin: string | null): NextResponse {
  const headers: Record<string, string> = {
    'x-request-id': requestId,
    ...getRateLimitHeaders(result),
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429, headers }
  );
}

function isApiRequest(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');

  let requestId = request.headers.get('x-request-id');
  if (!requestId) requestId = generateRequestId();

  // CORS preflight
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    response.headers.set('x-request-id', requestId);
    setCORS(response, origin, pathname);
    if (origin && ALLOWED_ORIGINS.some(ao => ao === '*' || ao === origin)) {
      response.headers.set('Access-Control-Max-Age', '86400');
    }
    return response;
  }

  // Public API routes: apply rate limiting or pass through
  if (isApiRequest(pathname) && isPublic(pathname)) {
    if (shouldBypassRateLimit(pathname)) {
      // Bypass rate limiting (webhooks, health, metrics)
      const response = NextResponse.next();
      response.headers.set('x-request-id', requestId);
      setCORS(response, origin, pathname);
      return response;
    }
    // IP-based rate limiting for public API routes
    const ip = getClientIp(request);
    const result = edgeLimiter.check(`rl:pub:${ip}`, RATE_LIMIT_UNAUTH, RATE_LIMIT_WINDOW_MS);
    if (!result.allowed) {
      return buildRateLimitResponse(requestId, result, origin);
    }
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    setCORS(response, origin, pathname);
    applyRateLimitHeaders(response, result);
    return response;
  }

  // Non-API public paths pass through with CORS
  if (!isApiRequest(pathname) && isPublic(pathname)) {
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    setCORS(response, origin, pathname);
    return response;
  }

  // Non-API protected pages require auth redirect (handled below)
  // API protected routes need auth + rate limiting (handled below)

  // Auth check for protected paths
  if (!JWT_SECRET) {
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    setCORS(response, origin, pathname);
    return response;
  }

  const cookieToken = request.cookies.get('nucrm_session')?.value;
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: { 'x-request-id': requestId } });
    }
    const url = new URL('/auth/login', request.url);
    url.searchParams.set('callbackUrl', pathname);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('x-request-id', requestId);
    return redirect;
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub) throw new Error('Invalid token');

    // CSRF protection for state-changing API requests
    if (isApiRequest(pathname)) {
      const authMethod = request.headers.get('x-auth-method') || undefined;
      if (needsCsrfValidation(request.method, pathname, authMethod)) {
        const cookieCsrf = getCsrfTokenFromCookie(request.headers.get('cookie') || null);
        const headerCsrf = getCsrfTokenFromHeader(request.headers);
        if (!validateCsrfToken(cookieCsrf, headerCsrf)) {
          return NextResponse.json({ error: 'CSRF token missing or invalid. Please refresh the page and try again.' }, { status: 403, headers: { 'x-request-id': requestId } });
        }
      }

      // Authenticated API rate limiting (by user)
      if (!shouldBypassRateLimit(pathname)) {
        const userId = payload.sub;
        const isApiKey = authHeader?.startsWith('Bearer ') && token !== cookieToken && !cookieToken;
        const max = isApiKey ? RATE_LIMIT_API_KEY : RATE_LIMIT_AUTH;
        const key = isApiKey ? `rl:apikey:${userId}` : `rl:user:${userId}`;
        const result = edgeLimiter.check(key, max, RATE_LIMIT_WINDOW_MS);
        if (!result.allowed) {
          return buildRateLimitResponse(requestId, result, origin);
        }
        const response = NextResponse.next();
        response.headers.set('x-request-id', requestId);
        setCORS(response, origin, pathname);
        applyRateLimitHeaders(response, result);
        return response;
      }
    }

    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    setCORS(response, origin, pathname);
    return response;
  } catch {
    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401, headers: { 'x-request-id': requestId } });
    }
    const redirect = NextResponse.redirect(new URL('/auth/login', request.url));
    redirect.headers.set('x-request-id', requestId);
    return redirect;
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
