import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';

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
  return {
    headers,
    status: overrides.status ?? 200,
    _isResponse: true,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NextResponse(this: any, body: any, init?: { status?: number; headers?: Record<string, string> }) {
  const headers = makeHeaders();
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      headers.set(k, v);
    }
  }
  this.headers = headers;
  this.status = init?.status ?? 200;
  this.body = body;
  this._isResponse = true;
}

// Capture the forwarded request headers (init.request.headers) so tests can
// assert the proxy propagates x-request-id onto the request (observability).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
NextResponse.next = (init?: { request?: { headers?: any } }) =>
  makeResponse({ _isNext: true, _requestHeaders: init?.request?.headers });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
NextResponse.json = (body: any, init?: any) => makeResponse({ ...init, body, _isJson: true });
NextResponse.redirect = (url: string) => ({ url, _isRedirect: true, headers: makeHeaders() });

vi.mock('next/server', () => ({ NextResponse, NextRequest: class MockNextRequest {} }));

const mockJwtVerify = vi.fn();
vi.mock('jose', () => ({ jwtVerify: mockJwtVerify }));

vi.mock('@/lib/auth/csrf', () => ({
  getCsrfTokenFromCookie: vi.fn().mockReturnValue('cookie-csrf'),
  getCsrfTokenFromHeader: vi.fn().mockReturnValue('header-csrf'),
  needsCsrfValidation: vi.fn().mockReturnValue(false),
  validateCsrfToken: vi.fn().mockReturnValue(true),
}));

const edgeCheckMock = vi.fn(() => ({ allowed: true, remaining: 59, reset: Date.now() + 60000, limit: 60 }));
vi.mock('@/lib/rate-limit-edge', () => ({
  edgeLimiter: {
    check: edgeCheckMock,
    reset: vi.fn(),
    clear: vi.fn(),
    size: 0,
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRateLimitHeaders: vi.fn((r: any) => ({
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(Math.ceil(r.reset / 1000)),
    'Retry-After': r.allowed ? '0' : '30',
  })),
  shouldBypassRateLimit: vi.fn((p: string) =>
    ['/api/webhooks/', '/api/health', '/api/metrics', '/api/keepalive', '/api/cron', '/api/track/event'].some(x => p.startsWith(x))
  ),
}));

function makeReq(pathnameWithQuery: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
} = {}) {
  const qIdx = pathnameWithQuery.indexOf('?');
  const pathname = qIdx === -1 ? pathnameWithQuery : pathnameWithQuery.slice(0, qIdx);
  const search = qIdx === -1 ? '' : pathnameWithQuery.slice(qIdx + 1);
  return {
    nextUrl: { pathname, searchParams: new URLSearchParams(search) },
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

describe('proxy middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('process', {
      ...process,
      env: {
        ...process.env,
        JWT_SECRET: 'test-secret-for-jwt',
        ALLOWED_ORIGINS: 'http://localhost:3000',
      },
    });
    edgeCheckMock.mockReturnValue({ allowed: true, remaining: 59, reset: Date.now() + 60000, limit: 60 });
    mockJwtVerify.mockReset();
  });

  describe('OPTIONS preflight', () => {
    it('returns 204', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/contacts', { method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } }));
      expect(res.status).toBe(204);
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });
  });

  describe('public paths', () => {
    it('passes through public API routes', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/health'));
      expect(res._isNext || res._isResponse).toBeTruthy();
    });

    it('passes through non-API public routes', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/auth/login'));
      expect(res._isNext || res._isResponse).toBeTruthy();
    });

    // #1972: /api/track/event is an intentionally anonymous ingest endpoint
    // (always 204, self rate-limited at 120/min/IP). The proxy must let it
    // through without JWT auth and without the 30/min public edge limiter.
    it('passes anonymous POST /api/track/event without auth or edge rate limit', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/track/event', { method: 'POST' }));
      expect(res._isNext).toBe(true);
      expect(edgeCheckMock).not.toHaveBeenCalled();
    });
  });

  // Five handlers authenticate something other than a user session — a client
  // secret, a provider HMAC, a per-plugin webhook secret — so no caller can ever
  // present the JWT the edge demanded of them. Measured on the running app before
  // this list existed: POST to each answered 401 {"error":"Authentication required"}
  // from the middleware, i.e. the handler never ran. This is #2415's class again
  // (e-sign and CSAT were missing from the same list and got added there).
  describe('session-free credential routes', () => {
    const credentialRoutes = [
      '/api/auth/oauth/token',
      '/api/auth/oauth/revoke',
      '/api/webhooks/razorpay',
      '/api/webhooks/payu',
      '/api/webhooks/telegram/bot',
      '/api/tenant/plugins/webhook/0f9d0000-0000-4000-8000-000000000001',
    ];

    it.each(credentialRoutes)('lets POST %s reach its handler', async (pathname) => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq(pathname, { method: 'POST' }));
      expect(res._isNext).toBe(true);
    });

    // The webhook receivers are exempt from the edge's rl:pub budget by design
    // (proxy.ts — a provider retrying from rotating IPs must not be throttled),
    // so each of them has to be cheap before it does anything. Measured in the
    // handlers: telegram compares X-Telegram-Bot-Api-Secret-Token with
    // timingSafeEqual before reading the body, razorpay HMAC-verifies before its
    // first query, payu returns 503 unless configured and sha512-verifies the
    // posted hash (length-checked timingSafeEqual) before its first query, and the
    // plugin route rejects on a missing secret with 403. The two OAuth routes are
    // not exempt and do self-limit at 20/min.
    it('does not put the webhook receivers under the edge unauthenticated budget', async () => {
      const { proxy } = await import('@/proxy');
      await proxy(makeReq('/api/webhooks/telegram/bot', { method: 'POST' }));
      expect(edgeCheckMock).not.toHaveBeenCalled();
    });

    // /api/tenant/visitors/track is NOT one of those handlers — no credential, no
    // signature, no limiter — and it stays behind the session check until it earns
    // a secret and a bucket of its own.
    it('keeps POST /api/tenant/visitors/track behind the session check', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/tenant/visitors/track', { method: 'POST' }));
      expect(res._isNext).toBeFalsy();
      expect(res.status).toBe(401);
    });
  });

  // #1992: CSP/nonce work belongs on HTML document responses only — RSC
  // flight-payload prefetches must skip it, and the nonce must be edge-safe
  // (WebCrypto base64, still matching Next's nonce regex).
  describe('CSP + RSC prefetches (#1992)', () => {
    it('layers a valid nonce CSP on a public HTML page navigation', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/auth/login'));
      const csp = res.headers.get('content-security-policy');
      expect(csp).toContain("script-src 'self' 'nonce-");
      const nonce = res.headers.get('x-nonce') as string;
      expect(nonce).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
      expect(nonce.length).toBe(24); // 16 random bytes -> 24 base64 chars
    });

    it('skips the CSP build for public RSC prefetches (?_rsc=…)', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/auth/login?_rsc=abc123'));
      expect(res._isNext).toBe(true);
      expect(res.headers.get('content-security-policy')).toBeNull();
      expect(res.headers.get('x-nonce')).toBeNull();
    });

    it('skips the CSP build for authenticated RSC prefetches (RSC: true) but keeps it for navigations', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-1' } });
      const { proxy } = await import('@/proxy');
      const prefetch = await proxy(makeReq('/tenant/contacts', {
        headers: { rsc: 'true' },
        cookies: { nucrm_session: 'jwt-token' },
      }));
      expect(prefetch.headers.get('content-security-policy')).toBeNull();

      const navigation = await proxy(makeReq('/tenant/contacts', {
        cookies: { nucrm_session: 'jwt-token' },
      }));
      expect(navigation.headers.get('content-security-policy')).toContain('nonce-');
    });
  });

  describe('rate limiting - public API', () => {
    it('allows requests within limit', async () => {
      edgeCheckMock.mockReturnValue({ allowed: true, remaining: 29, reset: Date.now() + 60000, limit: 30 });
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/leads/public'));
      expect(res._isNext).toBe(true);
    });

    it('blocks requests over the limit (429)', async () => {
      edgeCheckMock.mockReturnValue({ allowed: false, remaining: 0, reset: Date.now() + 60000, limit: 30 });
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/leads/public'));
      expect(res.status).toBe(429);
    });

    it('bypasses webhooks', async () => {
      await (await import('@/proxy')).proxy(makeReq('/api/webhooks/stripe'));
      expect(edgeCheckMock).not.toHaveBeenCalled();
    });

    it('bypasses health and metrics', async () => {
      const { proxy } = await import('@/proxy');
      for (const p of ['/api/health', '/api/metrics', '/api/keepalive', '/api/cron']) {
        await proxy(makeReq(p));
      }
      expect(edgeCheckMock).not.toHaveBeenCalled();
    });
  });

  describe('authenticated API routes', () => {
    beforeEach(() => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } });
    });

    it('allows requests within limit', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/tenant/contacts', { cookies: { nucrm_session: 'valid-token' } }));
      expect(res._isNext).toBe(true);
      const key = edgeCheckMock.mock.calls[0]?.[0] as string;
      expect(key).toContain('rl:user:');
    });

    it('blocks requests over limit', async () => {
      edgeCheckMock.mockReturnValue({ allowed: false, remaining: 0, reset: Date.now() + 60000, limit: 120 });
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/tenant/contacts', { cookies: { nucrm_session: 'valid-token' } }));
      expect(res.status).toBe(429);
    });

    it('#2117: reads use a dedicated rl:user:<id>:read bucket at 300/min', async () => {
      const { proxy } = await import('@/proxy');
      await proxy(makeReq('/api/tenant/contacts', { cookies: { nucrm_session: 'valid-token' } }));
      const [key, max] = edgeCheckMock.mock.calls[0] as [string, number];
      expect(key).toBe('rl:user:user-123:read');
      expect(max).toBe(300);
    });

    it('#2117: writes keep the 120/min budget on rl:user:<id>:write', async () => {
      const { proxy } = await import('@/proxy');
      await proxy(makeReq('/api/tenant/contacts', { method: 'POST', cookies: { nucrm_session: 'valid-token' } }));
      const [key, max] = edgeCheckMock.mock.calls[0] as [string, number];
      expect(key).toBe('rl:user:user-123:write');
      expect(max).toBe(120);
    });

    it('rejects unauthenticated requests', async () => {
      mockJwtVerify.mockRejectedValue(new Error('no token'));
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/tenant/contacts'));
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated non-API with redirect', async () => {
      mockJwtVerify.mockRejectedValue(new Error('no token'));
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/dashboard'));
      expect(res._isRedirect).toBe(true);
    });
  });

  // #2215: the `ak_` Bearer pass-through used to skip JWT verification, CSRF
  // and edge rate limiting on EVERY path — which made the deprecated
  // POST /api/v1/auth/login anonymously brute-forceable with a junk
  // `Bearer ak_x`. It is now gated to the data-API surfaces and rate limited.
  describe('ak_ API-key pass-through gating (#2215)', () => {
    it('rejects a junk ak_ Bearer on /api/v1/auth/login with 401 instead of bypassing', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/v1/auth/login', {
        method: 'POST',
        headers: { authorization: 'Bearer ak_live_deadbeef' },
      }));
      expect(res.status).toBe(401);
      expect(res._isNext).toBeUndefined();
    });

    it('rejects ak_ Bearer on non-key surfaces (e.g. tenant dashboard page)', async () => {
      const { proxy } = await import('@/proxy');
      // Non-API page path: no cookie -> redirect to login, not a pass-through.
      const res = await proxy(makeReq('/tenant/dashboard', {
        headers: { authorization: 'Bearer ak_live_deadbeef' },
      }));
      expect(res._isRedirect).toBe(true);
      expect(res._isNext).toBeUndefined();
    });

    it('passes ak_ Bearer through on /api/v1 data routes WITH an IP-keyed edge budget', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/v1/leads', {
        headers: { authorization: 'Bearer ak_live_deadbeef' },
      }));
      expect(res._isNext).toBe(true);
      expect(edgeCheckMock).toHaveBeenCalled();
      const key = edgeCheckMock.mock.calls[0][0] as string;
      expect(key).toMatch(/^rl:apikey-edge:/);
    });

    it('treats an ak_ value in the session cookie as no token (never a JWT bypass)', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/tenant/contacts', {
        cookies: { nucrm_session: 'ak_live_deadbeef' },
      }));
      expect(res.status).toBe(401);
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });
  });

  describe('requestId', () => {
    it('sets x-request-id on responses', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/health'));
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });

    // Observability: the id the proxy owns must also be forwarded onto the
    // REQUEST so requireAuth seeds its ALS with it and logError can correlate
    // the DB error row / Sentry event with the request.
    it('propagates x-request-id onto the forwarded request (public pass-through)', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/leads/public'));
      const fwd = res._requestHeaders?.get('x-request-id');
      expect(fwd).toBeTruthy();
      expect(fwd).toBe(res.headers.get('x-request-id'));
    });

    it('reuses an incoming x-request-id instead of minting a new one', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/leads/public', { headers: { 'x-request-id': 'incoming-123' } }));
      expect(res.headers.get('x-request-id')).toBe('incoming-123');
      expect(res._requestHeaders?.get('x-request-id')).toBe('incoming-123');
    });

    it('propagates x-request-id onto authenticated API pass-through', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } });
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/tenant/contacts', { cookies: { nucrm_session: 'valid-token' } }));
      const fwd = res._requestHeaders?.get('x-request-id');
      expect(fwd).toBeTruthy();
      expect(fwd).toBe(res.headers.get('x-request-id'));
    });
  });

  // #2313: `/login` is a bookmarked legacy alias with no route behind it.
  // Anonymous visitors must keep the exact 307 → /auth/login?callbackUrl=%2Flogin;
  // authenticated sessions used to fall through the proxy and hard-404 on the
  // missing page — they must now be redirected to the post-login landing.
  describe('/login alias by auth state (#2313)', () => {
    it('keeps the anonymous 307 to /auth/login?callbackUrl=%2Flogin byte-identical', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/login'));
      expect(res._isRedirect).toBe(true);
      expect(res._isNext).toBeUndefined();
      expect(String(res.url)).toBe('http://localhost:3000/auth/login?callbackUrl=%2Flogin');
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });

    it('redirects an authenticated session to /tenant/dashboard instead of 404ing', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } });
      const { proxy } = await import('@/proxy');
      // Unique token: the module-level 10s JWT cache (#1992) persists across
      // tests, so reusing 'valid-token' could skip jwtVerify and fail the spy.
      const res = await proxy(makeReq('/login', { cookies: { nucrm_session: 'login-alias-2313-token' } }));
      expect(res._isRedirect).toBe(true);
      // Must NOT fall through to the router (that fall-through was the 404).
      expect(res._isNext).toBeUndefined();
      expect(String(res.url)).toBe('http://localhost:3000/tenant/dashboard');
      expect(res.headers.get('x-request-id')).toBeTruthy();
      expect(mockJwtVerify).toHaveBeenCalled();
    });

    it('does not change behavior for other authenticated page navigations', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } });
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/tenant/contacts', { cookies: { nucrm_session: 'valid-token' } }));
      expect(res._isNext).toBe(true);
      expect(res._isRedirect).toBeUndefined();
      expect(res.headers.get('content-security-policy')).toContain('nonce-');
    });

    it('does not change behavior for other anonymous protected paths (callbackUrl intact)', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/tenant/contacts'));
      expect(res._isRedirect).toBe(true);
      expect(String(res.url)).toBe('http://localhost:3000/auth/login?callbackUrl=%2Ftenant%2Fcontacts');
    });
  });

  // #2415: the seam between the edge and the public routes went untested for
  // as long as both halves existed — `proxy()` was tested for the auth split,
  // the handlers were tested by calling them directly, and nothing ever asked
  // whether an anonymous browser request *reaches* a handler. /api/public/sign
  // and /api/public/csat were 401'd by the edge from the day they shipped.
  // Paths are derived from the route tree rather than listed by hand, so the
  // next public route added without a PUBLIC_PATHS entry fails here instead of
  // shipping dead.
  const publicApiRoutePaths = (() => {
    const root = join(process.cwd(), 'app', 'api', 'public');
    const walk = (rel: string): string[] =>
      readdirSync(rel ? join(root, rel) : root, { withFileTypes: true }).flatMap((ent) => {
        const child = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) return walk(child);
        if (ent.name !== 'route.ts') return [];
        return ['/api/public/' + child.replace(/\/route\.ts$/, '').replace(/\[[^\]]+\]/g, 'TOKEN')];
      });
    return walk('').sort();
  })();

  describe('public API routes reach their handler anonymously (#2415)', () => {
    it('derives the list from app/api/public, not from a hand-written roster', () => {
      expect(publicApiRoutePaths).toContain('/api/public/sign/TOKEN');
      expect(publicApiRoutePaths).toContain('/api/public/csat/TOKEN');
      expect(publicApiRoutePaths.length).toBeGreaterThanOrEqual(14);
    });

    for (const path of publicApiRoutePaths) {
      for (const method of ['GET', 'POST']) {
        it(`${method} ${path} passes the edge with no session`, async () => {
          const { proxy } = await import('@/proxy');
          const res = await proxy(makeReq(path, { method }));
          expect(res._isNext, `${method} ${path} was intercepted: ${JSON.stringify(res.body ?? res.status)}`).toBe(true);
        });
      }
    }

    it('control: a protected API path is still 401 for an anonymous caller', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/tenant/contacts'));
      expect(res.status).toBe(401);
    });
  });
});
