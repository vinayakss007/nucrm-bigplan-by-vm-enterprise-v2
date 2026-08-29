import { describe, it, expect, vi, beforeEach } from 'vitest';

// Nonce-based CSP tests for Issue #1070. Mocks next/server + auth deps the same
// way tests/unit/proxy.test.ts does, then asserts the per-request CSP emitted by
// proxy.ts drops script-src 'unsafe-inline' in favour of a per-request nonce.

type MockHeaders = Map<string, string> & { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

function makeHeaders(init?: Record<string, string>): MockHeaders {
  const map = new Map<string, string>() as MockHeaders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map.set = vi.fn((k: string, v: string) => { Map.prototype.set.call(map, k.toLowerCase(), v); return map; }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map.get = vi.fn((k: string) => Map.prototype.get.call(map, k.toLowerCase()) || null) as any;
  if (init) for (const [k, v] of Object.entries(init)) map.set(k, v);
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
    for (const [k, v] of Object.entries(init.headers)) headers.set(k, v);
  }
  this.headers = headers;
  this.status = init?.status ?? 200;
  this.body = body;
  this._isResponse = true;
}

// NextResponse.next() may receive { request: { headers } } — capture the
// forwarded request headers so tests can assert the CSP was set on the request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
NextResponse.next = (init?: { request?: { headers?: any } }) =>
  makeResponse({ _isNext: true, _requestHeaders: init?.request?.headers });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
NextResponse.json = (body: any, init?: any) => makeResponse({ ...init, body, _isJson: true });
NextResponse.redirect = (url: string) => ({ url, _isRedirect: true, headers: makeHeaders() });

// Global Headers used by proxy.ts nextWithCsp() to clone request headers.
vi.stubGlobal('Headers', class {
  private m = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(init?: any) {
    if (init && typeof init.forEach === 'function') init.forEach((v: string, k: string) => this.m.set(k.toLowerCase(), v));
    else if (init && typeof init.entries === 'function') for (const [k, v] of init.entries()) this.m.set(String(k).toLowerCase(), String(v));
  }
  set(k: string, v: string) { this.m.set(k.toLowerCase(), v); }
  get(k: string) { return this.m.get(k.toLowerCase()) ?? null; }
});

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
  edgeLimiter: { check: edgeCheckMock, reset: vi.fn(), clear: vi.fn(), size: 0 },
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
    headers: makeHeaders(opts.headers || {}),
    cookies: {
      get: (name: string) => {
        const v = (opts.cookies || {})[name];
        return v ? { value: v } : undefined;
      },
    },
    url: `http://localhost:3000${pathname}`,
  };
}

describe('nonce-based CSP (#1070)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'test-secret-for-jwt', ALLOWED_ORIGINS: 'http://localhost:3000' },
    });
    edgeCheckMock.mockReturnValue({ allowed: true, remaining: 59, reset: Date.now() + 60000, limit: 60 });
    mockJwtVerify.mockReset();
  });

  it('page GET response CSP uses a script-src nonce and drops script-src unsafe-inline', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/auth/login'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('sets an x-nonce response header whose value appears in the CSP script-src', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/auth/login'));
    const nonce = res.headers.get('x-nonce');
    const csp = res.headers.get('content-security-policy');
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
  });

  it('uses the SAME per-request nonce for script-src and style-src', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/auth/login'));
    const nonce = res.headers.get('x-nonce');
    const csp = res.headers.get('content-security-policy');
    expect(nonce).toBeTruthy();
    // Both directives must carry the identical request nonce.
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src-elem 'self' 'nonce-${nonce}'`);
  });

  it('sets the CSP on the forwarded request headers so Next app-render sees the nonce', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/auth/login'));
    const reqCsp = res._requestHeaders?.get('content-security-policy');
    expect(reqCsp).toBeTruthy();
    expect(reqCsp).toBe(res.headers.get('content-security-policy'));
    expect(res._requestHeaders?.get('x-nonce')).toBe(res.headers.get('x-nonce'));
  });

  it('generates a different nonce per request', async () => {
    const { proxy } = await import('@/proxy');
    const a = await proxy(makeReq('/auth/login'));
    const b = await proxy(makeReq('/auth/login'));
    expect(a.headers.get('x-nonce')).toBeTruthy();
    expect(b.headers.get('x-nonce')).toBeTruthy();
    expect(a.headers.get('x-nonce')).not.toBe(b.headers.get('x-nonce'));
  });

  it('retains all other hardened directives unchanged', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/auth/login'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'self'");
    // style-src is nonce-based now (#1070); 'unsafe-inline' only survives for
    // style ATTRIBUTES via style-src-attr, never for <style> elements.
    expect(csp).toContain("style-src 'self' 'nonce-");
    expect(csp).toContain("style-src-elem 'self' 'nonce-");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it('applies the page CSP to authenticated page navigations', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } });
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/dashboard', { cookies: { nucrm_session: 'valid-token' } }));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(res.headers.get('x-nonce')).toBeTruthy();
  });

  it('does NOT put the page CSP on /api/ responses', async () => {
    const { proxy } = await import('@/proxy');
    const pub = await proxy(makeReq('/api/leads/public'));
    expect(pub.headers.get('content-security-policy')).toBeNull();
    expect(pub.headers.get('x-nonce')).toBeNull();

    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } });
    const authed = await proxy(makeReq('/api/tenant/contacts', { cookies: { nucrm_session: 'valid-token' } }));
    expect(authed.headers.get('content-security-policy')).toBeNull();
    expect(authed.headers.get('x-nonce')).toBeNull();
  });

  it('adds unsafe-eval to script-src in dev only', async () => {
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, NODE_ENV: 'development', JWT_SECRET: 'test-secret-for-jwt', ALLOWED_ORIGINS: 'http://localhost:3000' },
    });
    vi.resetModules();
    const { proxy } = await import('@/proxy');
    const res = await proxy(makeReq('/auth/login'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("script-src 'self' 'nonce-");
  });
});

describe('CSP single-source-of-truth file assertions (#1070)', () => {
  it('next.config.mjs no longer sets a script-src unsafe-inline CSP', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('next.config.mjs', 'utf-8');
    expect(content).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(content).not.toContain("key: 'Content-Security-Policy'");
  });

  it('nginx.conf no longer sets a script-src unsafe-inline CSP', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('nginx.conf', 'utf-8');
    expect(content).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(content).not.toContain('add_header Content-Security-Policy');
  });

  it('proxy.ts emits nonce-based script-src AND style-src, with unsafe-inline scoped to style-src-attr only', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('proxy.ts', 'utf-8');
    expect(content).toContain("script-src 'self' 'nonce-");
    expect(content).toContain("style-src 'self' 'nonce-");
    expect(content).toContain("style-src-attr 'unsafe-inline'");
    // No blanket element-level unsafe-inline for scripts or styles.
    expect(content).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(content).not.toContain("style-src 'self' 'unsafe-inline'");
  });
});
