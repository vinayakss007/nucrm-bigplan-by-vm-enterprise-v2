/**
 * #2579 — the edge may skip CSRF only for a credential the edge can see is not ambient.
 *
 * `proxy.ts` answers the CSRF double-submit check for every `/api/` mutation, but the
 * `Bearer ak_*` pass-through sat *above* it. A request carrying both a junk API key and a
 * live session cookie therefore left this file unchecked, and `requireAuth()` then
 * authenticated it with the cookie anyway: `lib/auth/middleware.ts:241` tries
 * `tryApiKeyAuth()` first, a key absent from `api_keys` returns null, and `:262` falls back
 * to `extractToken()`, which prefers `nucrm_session`. Net effect: a cookie-authenticated
 * mutation with no CSRF validation anywhere in the stack, reachable for anything on the
 * site's own origin (stored XSS, a pasted bookmarklet) or on an origin listed in
 * `ALLOWED_ORIGINS` — the only origins whose cross-site `Authorization` header survives
 * preflight (`proxy.ts:307-319`).
 *
 * The same file had a second, smaller version of the problem: `x-auth-method` is a
 * client-settable header whose only effect is to exempt the request from CSRF. No first-party
 * code sends it (`app/`, `lib/`, `postman/`, `scripts/` contain no writer), so for a
 * cookie-authenticated request it was purely a way for the caller to switch the defense off.
 *
 * Assertions go through the *real* `needsCsrfValidation`/`validateCsrfToken` (only the token
 * *sources* are stubbed) so a passing test means the response was actually refused, not that
 * a mock was called. The attacker-shaped request is the one with no `X-CSRF-Token` header:
 * a same-origin script can read cookies but a cross-site form/post cannot attach the header.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type MockHeaders = Map<string, string> & { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

function makeHeaders(): MockHeaders {
  const map = new Map<string, string>() as MockHeaders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map.set = vi.fn((k: string, v: string) => { Map.prototype.set.call(map, k, v); return map; }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map.get = vi.fn((k: string) => Map.prototype.get.call(map, k) || null) as any;
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeResponse(overrides: Record<string, any> = {}) {
  const headers = makeHeaders();
  return { headers, status: overrides.status ?? 200, _isResponse: true, ...overrides };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NextResponse(this: any, body: any, init?: { status?: number; headers?: Record<string, string> }) {
  const headers = makeHeaders();
  if (init?.headers) for (const [k, v] of Object.entries(init.headers)) headers.set(k, v);
  this.headers = headers;
  this.status = init?.status ?? 200;
  this.body = body;
  this._isResponse = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
NextResponse.next = (init?: { request?: { headers?: any } }) =>
  makeResponse({ _isNext: true, _requestHeaders: init?.request?.headers });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
NextResponse.json = (body: any, init?: any) => makeResponse({ ...init, body, _isJson: true });
NextResponse.redirect = (url: string) => ({ url, _isRedirect: true, headers: makeHeaders() });

vi.mock('next/server', () => ({ NextResponse, NextRequest: class MockNextRequest {} }));

const mockJwtVerify = vi.fn();
vi.mock('jose', () => ({ jwtVerify: mockJwtVerify }));

const needsCsrfSpy = vi.fn();
vi.mock('@/lib/auth/csrf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/csrf')>();
  // Real decision + real comparison; only where the tokens come from is stubbed, so
  // the double-submit check fails exactly when the header is absent. The spy wrapper
  // exists to read back the `authMethod` argument the proxy passes in — the
  // trustworthiness of that value is the other half of #2579.
  needsCsrfSpy.mockImplementation((m: string, p: string, am?: string) =>
    actual.needsCsrfValidation(m, p, am));
  return {
    ...actual,
    getCsrfTokenFromCookie: vi.fn(() => 'csrf-cookie-value'),
    getCsrfTokenFromHeader: vi.fn((headers: { get: (n: string) => string | null }) =>
      headers.get('x-csrf-token')),
    needsCsrfValidation: needsCsrfSpy,
  };
});

const edgeCheckMock = vi.fn(() => ({ allowed: true, remaining: 59, reset: Date.now() + 60000, limit: 60 }));
vi.mock('@/lib/rate-limit-edge', () => ({
  edgeLimiter: { check: edgeCheckMock, reset: vi.fn(), clear: vi.fn(), size: 0 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRateLimitHeaders: vi.fn((r: any) => ({
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(Math.ceil(r.reset / 1000)),
    'Retry-After': r.allowed ? '0' : '30',
  })),
  shouldBypassRateLimit: vi.fn(() => false),
}));

function makeReq(pathname: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
} = {}) {
  return {
    nextUrl: { pathname, searchParams: new URLSearchParams() },
    method: opts.method || 'GET',
    headers: new Map(Object.entries(opts.headers || {})),
    cookies: {
      get: (name: string) => {
        const v = (opts.cookies || {})[name];
        return v ? { value: v } : undefined;
      },
    },
    url: `http://localhost:3000${pathname}`,
  };
}

const SESSION = { nucrm_session: 'valid-jwt-token' };
const JUNK_KEY = { authorization: 'Bearer ak_live_deadbeef' };

/** A mutation as it arrives from a same-origin script: cookie attached, no CSRF header. */
const ATTACK = { method: 'POST', headers: JUNK_KEY, cookies: SESSION };

describe('proxy: CSRF is decided for every ambient-credential mutation (#2579)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, JWT_SECRET: 'test-secret-for-jwt', ALLOWED_ORIGINS: 'http://localhost:3000' },
    });
    edgeCheckMock.mockReturnValue({ allowed: true, remaining: 59, reset: Date.now() + 60000, limit: 60 });
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } });
  });

  it('refuses a junk ak_ bearer presented alongside a session cookie', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/api/tenant/contacts', ATTACK));

    // Before the fix this returned `NextResponse.next()` from the ak_ branch and the
    // handler authenticated off the cookie — a write with no CSRF check at all.
    expect(res._isNext).toBeUndefined();
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/CSRF/);
  });

  it('verifies the cookie on that path instead of passing it by', async () => {
    const { proxy } = await import('@/proxy');
    // A token this file has not seen before, so the assertion below cannot be
    // satisfied by the proxy's JWT cache from an earlier request.
    const res = await proxy(makeReq('/api/tenant/contacts', {
      ...ATTACK,
      cookies: { nucrm_session: 'ambient-token-checked-on-the-jwt-path' },
    }));

    // Falling through means the JWT path runs: the cookie is the credential in play,
    // and the CSRF decision receives no api_key exemption (third argument undefined).
    expect(res.status).toBe(403);
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'ambient-token-checked-on-the-jwt-path',
      expect.anything(),
    );
    expect(needsCsrfSpy).toHaveBeenCalledWith('POST', '/api/tenant/contacts', undefined);
  });

  it('will not let the client-settable x-auth-method header switch CSRF off for a cookie request', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/api/tenant/contacts', {
      method: 'POST',
      headers: { ...JUNK_KEY, 'x-auth-method': 'api_key' },
      cookies: SESSION,
    }));
    expect(res.status).toBe(403);
    // The exemption argument must be absent, not 'api_key', when a cookie is present.
    expect(needsCsrfSpy.mock.calls.some((c) => c[2] === 'api_key')).toBe(false);
  });

  it('still passes a bearer-only API key through untouched, budget included', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/api/tenant/contacts', { method: 'POST', headers: JUNK_KEY }));

    // No session cookie → nothing ambient to protect, so the early pass-through and
    // its api_key edge bucket stay exactly as #2215 left them.
    expect(res._isNext).toBe(true);
    expect(needsCsrfSpy).not.toHaveBeenCalled();
    expect(mockJwtVerify).not.toHaveBeenCalled();
    const key = edgeCheckMock.mock.calls.map((c) => c[0] as string).find((k) => k.startsWith('rl:apikey-edge:'));
    expect(key).toBeTruthy();
  });

  it('keeps the api_key exemption for a non-ambient caller', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/api/tenant/contacts', {
      method: 'POST',
      headers: { authorization: 'Bearer some-jwt-bearer', 'x-auth-method': 'api_key' },
    }));
    expect(res._isNext).toBe(true);
    expect(needsCsrfSpy.mock.calls.some((c) => c[2] === 'api_key')).toBe(true);
  });

  it('does not turn a GET into a CSRF problem on the way', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/api/tenant/contacts', { ...ATTACK, method: 'GET' }));
    expect(res._isNext).toBe(true);
  });

  it('still rejects ak_ on surfaces that never accept keys (#2215 unchanged)', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/api/v1/auth/login', { method: 'POST', headers: JUNK_KEY }));
    expect(res.status).toBe(401);
    expect(res._isNext).toBeUndefined();
  });
});
