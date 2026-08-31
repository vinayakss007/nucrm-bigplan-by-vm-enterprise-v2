/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * In-handler CSRF defense-in-depth (#1835).
 *
 * CSRF is already enforced globally at the edge in proxy.ts. `enforceCsrf()` is
 * a SECOND, in-handler check for the most sensitive mutating routes (billing,
 * invoices, roles, api-keys, integrations, profile) so a state-changing request
 * that somehow reaches a handler without passing the middleware (matcher edit,
 * internal dispatch, future runtime change) is still rejected.
 *
 * Hardening vs. lib/auth/middleware.requireCsrf(): the api-key CSRF exemption is
 * derived from the ACTUAL `Authorization: Bearer ak_...` token on the request,
 * NOT from the client-settable `x-auth-method` header. A cookie-authenticated
 * request therefore cannot spoof `x-auth-method: api_key` to skip CSRF.
 */
import { NextResponse } from 'next/server';
import {
  getCsrfTokenFromCookie,
  getCsrfTokenFromHeader,
  needsCsrfValidation,
  validateCsrfToken,
} from '@/lib/auth/csrf';

/**
 * Returns null when the request passes CSRF checks (or is exempt), or a 403
 * NextResponse when the double-submit token is missing / mismatched.
 *
 * Usage at the top of a sensitive mutating handler:
 *   const csrf = enforceCsrf(request);
 *   if (csrf) return csrf;
 */
export function enforceCsrf(request: Request): NextResponse | null {
  const method = request.method;
  const path = (() => {
    try {
      return new URL(request.url).pathname;
    } catch {
      return '';
    }
  })();

  // Only trust the api-key exemption when a REAL api-key bearer token is
  // present — never the spoofable x-auth-method header.
  const authHeader = request.headers.get('authorization') || '';
  const isApiKey = /^Bearer\s+ak_/i.test(authHeader);
  const authMethod = isApiKey ? 'api_key' : undefined;

  if (!needsCsrfValidation(method, path, authMethod)) {
    return null;
  }

  const cookieToken = getCsrfTokenFromCookie(request.headers.get('cookie'));
  const headerToken = getCsrfTokenFromHeader(request.headers);

  if (!validateCsrfToken(cookieToken, headerToken)) {
    return NextResponse.json(
      { error: 'CSRF token missing or invalid. Please refresh the page and try again.' },
      { status: 403 },
    );
  }

  return null;
}
