/**
 * #2275 — Secure-by-default session/CSRF cookies with COOKIE_SECURE override.
 *
 * Covers the central resolution in lib/auth/cookie-security plus the two
 * cookie-string builders that actually emit Set-Cookie headers
 * (makeSessionCookieString for nucrm_session, setCsrfCookie for
 * nucrm_csrf_token).
 */
import { describe, it, expect, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-only-32chars!';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_COOKIE_SECURE = process.env.COOKIE_SECURE;

const {
  resolveCookieSecure,
  requestIsHttps,
  cookieSecureForRequest,
} = await import('@/lib/auth/cookie-security');
const { makeSessionCookieString } = await import('@/lib/auth/session');
const { setCsrfCookie } = await import('@/lib/auth/csrf');

function setEnv(nodeEnv: string, cookieSecure?: string) {
  process.env.NODE_ENV = nodeEnv;
  if (cookieSecure === undefined) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = cookieSecure;
}

function httpReq() {
  return { headers: new Headers({ 'x-forwarded-proto': 'http' }), nextUrl: { protocol: 'http:' } };
}
function httpsReq() {
  return { headers: new Headers({ 'x-forwarded-proto': 'https' }), nextUrl: { protocol: 'https:' } };
}

afterEach(() => {
  setEnv(ORIGINAL_NODE_ENV ?? 'test', ORIGINAL_COOKIE_SECURE);
});

// ─── resolveCookieSecure precedence matrix ─────────────────────
describe('resolveCookieSecure (#2275)', () => {
  it('COOKIE_SECURE=true forces secure even over http in dev', () => {
    setEnv('development', 'true');
    expect(resolveCookieSecure(false)).toBe(true);
  });

  it('COOKIE_SECURE=true forces secure even when request is http in production', () => {
    setEnv('production', 'true');
    expect(resolveCookieSecure(false)).toBe(true);
  });

  it('production default forces secure even with an http request (fail-closed)', () => {
    setEnv('production');
    expect(resolveCookieSecure(false)).toBe(true);
    expect(cookieSecureForRequest(httpReq())).toBe(true);
  });

  it('dev default over http does not set secure (local sign-in keeps working)', () => {
    setEnv('development');
    expect(resolveCookieSecure(false)).toBe(false);
    expect(cookieSecureForRequest(httpReq())).toBe(false);
  });

  it('dev default over https sets secure', () => {
    setEnv('development');
    expect(cookieSecureForRequest(httpsReq())).toBe(true);
  });

  it('COOKIE_SECURE=false always wins, even in production', () => {
    setEnv('production', 'false');
    expect(resolveCookieSecure(true)).toBe(false);
    expect(cookieSecureForRequest(httpsReq())).toBe(false);
  });
});

// ─── requestIsHttps ─────────────────────────────────────────────
describe('requestIsHttps', () => {
  it('trusts x-forwarded-proto first (proxy-terminated TLS)', () => {
    expect(requestIsHttps({ headers: new Headers({ 'x-forwarded-proto': 'https' }), nextUrl: { protocol: 'http:' } })).toBe(true);
    expect(requestIsHttps({ headers: new Headers({ 'x-forwarded-proto': 'https, http' }), nextUrl: { protocol: 'http:' } })).toBe(true);
  });

  it('falls back to the parsed request protocol', () => {
    expect(requestIsHttps({ headers: new Headers(), nextUrl: { protocol: 'https:' } })).toBe(true);
    expect(requestIsHttps({ headers: new Headers(), nextUrl: { protocol: 'http:' } })).toBe(false);
  });
});

// ─── nucrm_session Set-Cookie string ────────────────────────────
describe('makeSessionCookieString Secure flag', () => {
  it('emits "; Secure" in production over an http request', () => {
    setEnv('production');
    expect(makeSessionCookieString('tok', undefined, false)).toContain('; Secure');
  });

  it('omits Secure in dev over http', () => {
    setEnv('development');
    expect(makeSessionCookieString('tok', undefined, false)).not.toContain('; Secure');
  });

  it('emits Secure in dev when the request was https', () => {
    setEnv('development');
    expect(makeSessionCookieString('tok', undefined, true)).toContain('; Secure');
  });

  it('COOKIE_SECURE=true forces Secure in dev over http', () => {
    setEnv('development', 'true');
    expect(makeSessionCookieString('tok', undefined, false)).toContain('; Secure');
  });

  it('COOKIE_SECURE=false downgrades even production', () => {
    setEnv('production', 'false');
    expect(makeSessionCookieString('tok', undefined, true)).not.toContain('; Secure');
  });
});

// ─── nucrm_csrf_token Set-Cookie string ─────────────────────────
describe('setCsrfCookie Secure flag', () => {
  it('defaults to the central resolution: production is Secure', () => {
    setEnv('production');
    expect(setCsrfCookie('tok')).toContain('Secure');
  });

  it('defaults to not Secure in dev over http', () => {
    setEnv('development');
    expect(setCsrfCookie('tok')).not.toContain('Secure');
  });

  it('COOKIE_SECURE=true forces Secure in dev', () => {
    setEnv('development', 'true');
    expect(setCsrfCookie('tok')).toContain('Secure');
  });

  it('explicit secure argument still honored', () => {
    setEnv('development', 'true');
    // Caller-provided value is a per-call override for request-agnostic tests.
    expect(setCsrfCookie('tok', false)).not.toContain('Secure');
  });
});
