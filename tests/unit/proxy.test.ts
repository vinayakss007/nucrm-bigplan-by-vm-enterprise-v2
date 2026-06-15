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

NextResponse.next = () => makeResponse({ _isNext: true });
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
    ['/api/webhooks/', '/api/health', '/api/metrics', '/api/keepalive', '/api/cron'].some(x => p.startsWith(x))
  ),
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

  describe('requestId', () => {
    it('sets x-request-id on responses', async () => {
      const { proxy } = await import('@/proxy');
      const res = await proxy(makeReq('/api/health'));
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });
  });
});
