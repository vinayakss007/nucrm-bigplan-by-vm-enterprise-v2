/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Single source of truth for the cookie `Secure` attribute (#2275).
 *
 * Precedence (first match wins):
 *   1. Explicit `COOKIE_SECURE` env ("true"/"false") ALWAYS wins — this lets a
 *      cleartext-HTTP deployment opt out deliberately, and lets a local HTTPS
 *      dev setup opt in.
 *   2. Production builds are fail-closed: Secure is emitted even when the
 *      proxy looks like HTTP, unless COOKIE_SECURE=false was set explicitly.
 *   3. Outside production: Secure when the request arrived over HTTPS,
 *      otherwise unset — so plain http://localhost dev keeps working.
 *
 * Kept dependency-free (no next/headers import at module scope) so it stays
 * safe to bundle in the edge proxy via lib/auth/csrf.
 */

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
 * Resolve the Secure flag for a cookie.
 *
 * @param requestHttps whether the current request arrived over HTTPS (see
 * {@link requestIsHttps}); only consulted outside production builds.
 */
export function resolveCookieSecure(requestHttps = false): boolean {
  const explicit = process.env['COOKIE_SECURE']?.trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  // Fail-closed: a production build must always emit Secure, even if the
  // reverse proxy presents the request as http.
  if (process.env['NODE_ENV'] === 'production') return true;
  return requestHttps;
}

/** Convenience: resolveCookieSecure keyed on an incoming request object. */
export function cookieSecureForRequest(request: {
  headers: Headers;
  nextUrl?: { protocol?: string };
}): boolean {
  return resolveCookieSecure(requestIsHttps(request));
}

/**
 * Best-effort HTTPS detection for code paths that only have the
 * `next/headers` store (server components / cookies() jar), not a request
 * object. Uses x-forwarded-proto; returns false when unavailable (static
 * generation, scripts, tests).
 */
export async function currentRequestIsHttps(): Promise<boolean> {
  try {
    const nh = await import('next/headers');
    const h = await nh.headers();
    const forwardedProto = h.get('x-forwarded-proto');
    if (forwardedProto) {
      return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
    }
    return false;
  } catch {
    return false;
  }
}

/** resolveCookieSecure for cookies() jar callers: awaits header-based detection. */
export async function resolveCookieSecureFromHeaders(): Promise<boolean> {
  return resolveCookieSecure(await currentRequestIsHttps());
}
