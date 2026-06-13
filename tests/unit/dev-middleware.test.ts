import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDevLogger = {
  request: vi.fn(),
  log: vi.fn(),
  time: vi.fn(),
  memory: vi.fn(),
  colors: {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
  },
};

vi.mock('@/lib/dev-logger', () => ({
  devLogger: mockDevLogger,
}));

const mockResponse = {
  headers: { set: vi.fn() },
  status: 200,
};

vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => mockResponse),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NODE_ENV;
});

function makeRequest(pathname: string, method = 'GET') {
  return {
    nextUrl: { pathname },
    method,
    headers: new Map([['x-forwarded-for', '203.0.113.42, proxy']]),
  };
}

describe('middleware', () => {
  it('skips _next/static paths', async () => {
    const { middleware } = await import('@/lib/dev-middleware');
    const req = makeRequest('/_next/static/chunk.js');
    await middleware(req as any);
    expect(mockDevLogger.request).not.toHaveBeenCalled();
  });

  it('skips /static paths', async () => {
    const { middleware } = await import('@/lib/dev-middleware');
    const req = makeRequest('/static/image.png');
    await middleware(req as any);
    expect(mockDevLogger.request).not.toHaveBeenCalled();
  });

  it('skips favicon.ico', async () => {
    const { middleware } = await import('@/lib/dev-middleware');
    const req = makeRequest('/favicon.ico');
    await middleware(req as any);
    expect(mockDevLogger.request).not.toHaveBeenCalled();
  });

  it('skips /dev/dashboard', async () => {
    const { middleware } = await import('@/lib/dev-middleware');
    const req = makeRequest('/dev/dashboard/overview');
    await middleware(req as any);
    expect(mockDevLogger.request).not.toHaveBeenCalled();
  });

  it('logs request in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const { middleware } = await import('@/lib/dev-middleware');
    const req = makeRequest('/api/contacts');
    const response = await middleware(req as any);
    expect(response).toBe(mockResponse);
    expect(response.headers.set).toHaveBeenCalledWith('X-Request-Start', expect.any(String));
  });

  it('sets X-Request-Start header', async () => {
    const { middleware } = await import('@/lib/dev-middleware');
    const req = makeRequest('/api/test');
    await middleware(req as any);
    expect(mockResponse.headers.set).toHaveBeenCalledWith('X-Request-Start', expect.any(String));
  });

  it('does not log in non-development mode', async () => {
    process.env.NODE_ENV = 'production';
    const { middleware } = await import('@/lib/dev-middleware');
    const req = makeRequest('/api/contacts');
    await middleware(req as any);
    expect(mockDevLogger.request).not.toHaveBeenCalled();
    expect(mockDevLogger.time).not.toHaveBeenCalled();
  });
});

describe('config matcher', () => {
  it('exports matcher config', async () => {
    const { config } = await import('@/lib/dev-middleware');
    expect(config).toHaveProperty('matcher');
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher[0]).toContain('_next/static');
  });
});
