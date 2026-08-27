/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from 'crypto';

/**
 * CSRF Protection Module
 * 
 * Implements Double Submit Cookie pattern for CSRF protection
 */

function getRandomValues(length: number): Uint8Array {
  return crypto.randomBytes(length);
}

function createHashSha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const CSRF_COOKIE_NAME = 'nucrm_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  const bytes = getRandomValues(32);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a CSRF token for secure storage
 */
function hashToken(token: string): string {
  return createHashSha256(token);
}

/**
 * Determine whether a request arrived over HTTPS.
 *
 * Behind a proxy/load balancer the TLS terminates upstream, so the app sees
 * plain HTTP on the wire; the original scheme is carried in x-forwarded-proto.
 * We trust that header first, then fall back to the parsed request URL protocol.
 */
export function requestIsHttps(request: {
  headers: Headers;
  nextUrl?: { protocol?: string };
}): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    // May be a comma-separated list (proto chain); the first entry is the client-facing one.
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return request.nextUrl?.protocol === 'https:';
}

/**
 * Set CSRF token in cookie.
 *
 * The `secure` flag controls the cookie's `Secure` attribute. Callers should
 * set it when the request is served over HTTPS (see {@link requestIsHttps}) or
 * when running in production. It is intentionally keyed on the actual request
 * protocol rather than NODE_ENV alone so the cookie is marked Secure whenever
 * the connection is encrypted.
 *
 * HttpOnly is deliberately omitted: the double-submit-cookie pattern requires
 * client-side JS to read the token. SameSite=Strict is preserved.
 */
export function setCsrfCookie(token: string, secure: boolean = false): string {
  const cookieOptions = [
    `${CSRF_COOKIE_NAME}=${token}`,
    'Path=/',
    'SameSite=Strict',
    'Max-Age=2592000',
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
  
  return cookieOptions;
}

/**
 * Extract CSRF token from cookie header
 */
export function getCsrfTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  
  const match = cookieHeader.match(/(?:^|;\s*)nucrm_csrf_token=([^;]+)/);
  return match?.[1] ?? null;
}

/**
 * Extract CSRF token from request header
 */
export function getCsrfTokenFromHeader(headers: Headers, headerName: string = CSRF_HEADER_NAME): string | null {
  return headers.get(headerName) ?? null;
}

/**
 * Validate CSRF token using Double Submit Cookie pattern
 * 
 * This pattern works by:
 * 1. Setting a random token in a cookie (HttpOnly: false, so JS can read it)
 * 2. Client sends the token in a custom header (X-CSRF-Token)
 * 3. Server compares cookie token with header token
 * 
 * Since attacker cannot read the cookie (same-origin policy) or set custom headers,
 * they cannot forge a valid request.
 */
export function validateCsrfToken(
  cookieToken: string | null,
  headerToken: string | null
): boolean {
  if (!cookieToken || !headerToken) {
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  const cookieHash = hashToken(cookieToken);
  const headerHash = hashToken(headerToken);
  
  if (cookieHash.length !== headerHash.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < cookieHash.length; i++) {
    result |= cookieHash.charCodeAt(i) ^ headerHash.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Middleware to validate CSRF token for state-changing requests
 * 
 * Safe methods (GET, HEAD, OPTIONS) are exempt from CSRF protection
 */
export function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * Check if request needs CSRF validation
 * 
 * Exemptions:
 * - Safe HTTP methods (GET, HEAD, OPTIONS)
 * - API key authenticated requests (already secure)
 * - Webhook endpoints (use signature verification)
 * - Pre-auth routes (user has no CSRF cookie yet)
 * - Public/form endpoints (no session)
 */
export function needsCsrfValidation(method: string, path: string, authMethod?: string): boolean {
  if (isSafeMethod(method)) return false;
  if (authMethod === 'api_key') return false;
  if (path.startsWith('/api/webhooks/')) return false;
  if (path.startsWith('/api/cron/')) return false;
  if (path.startsWith('/api/forms/')) return false;
  if (path.startsWith('/api/leads/public/')) return false;
  if (path.startsWith('/api/setup/')) return false;
  if (path.startsWith('/api/tenant/onboarding')) return false;

  // Pre-auth auth routes — user has no CSRF cookie when making these requests
  // login/signup: session cookie not yet set
  // NOTE: /api/auth/forgot-password is intentionally NOT exempted here. While the
  // user may not have a session, if they DO have a CSRF cookie (e.g., already logged
  // in on another tab), removing the exemption prevents attackers from triggering
  // password reset spam via cross-site POST. The forgot-password form page must
  // ensure a CSRF cookie is set before POSTing (standard behavior for app forms).
  if (
    path === '/api/auth/login' ||
    path === '/api/auth/signup' ||
    path === '/api/auth/resend-verification' ||
    path === '/api/auth/verify-email'
  ) {
    return false;
  }

  return true;
}
