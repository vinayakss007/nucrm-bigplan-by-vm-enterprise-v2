/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * CSRF Protection Module
 *
 * Implements Double Submit Cookie pattern for CSRF protection
 *
 * #1992: this module runs inside the edge proxy bundle as well as Node
 * route handlers, so it must not import Node's `crypto` — that dragged the
 * entire Node module into the edge bundle for every request. All entropy
 * now comes from the WebCrypto global, which exists in both runtimes.
 */

function getRandomValues(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

import { resolveCookieSecure } from './cookie-security';

// #2275: requestIsHttps moved to lib/auth/cookie-security (single Secure-flag
// resolution for every Set-Cookie writer); re-exported here for existing
// callers and tests.
export { requestIsHttps } from './cookie-security';

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
 * Set CSRF token in cookie.
 *
 * `secure` controls the cookie's `Secure` attribute. When omitted it is
 * resolved centrally via {@link resolveCookieSecure} (#2275): explicit
 * COOKIE_SECURE wins, production is fail-closed Secure, otherwise Secure only
 * when the request arrived over HTTPS. Callers with a request object should
 * pass cookieSecureForRequest(request).
 *
 * HttpOnly is deliberately omitted: the double-submit-cookie pattern requires
 * client-side JS to read the token. SameSite=Strict is preserved.
 */
export function setCsrfCookie(token: string, secure?: boolean): string {
  const isSecure = secure ?? resolveCookieSecure();
  const cookieOptions = [
    `${CSRF_COOKIE_NAME}=${token}`,
    'Path=/',
    'SameSite=Strict',
    'Max-Age=2592000',
    isSecure ? 'Secure' : null,
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

  // Constant-time comparison to prevent timing attacks. #1992: the pre-
  // comparison SHA-256 (via Node crypto) only existed to normalize length for
  // timingSafeEqual; both values here are same-origin double-submit copies of
  // a 64-hex-char token, so a direct length-checked XOR walk is equivalent
  // and stays edge-compatible (no Node crypto in the proxy bundle).
  if (cookieToken.length !== headerToken.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < cookieToken.length; i++) {
    result |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
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
  // #2220: /api/tenant/onboarding* is no longer exempt. The exemption was
  // written for the pre-auth signup wizard, which has since been removed —
  // the routes under it are requireAuth state-changers now, and the prefix
  // also silently swallowed any future onboarding/* route.

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
