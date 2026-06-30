import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      plans: { findFirst: vi.fn(async () => null) },
      users: { findFirst: vi.fn(async () => null) },
      systemSettings: { findFirst: vi.fn(async () => null) },
    },
  },
}));

vi.mock('@/drizzle/schema', () => ({
  plans: {},
  users: {},
  systemSettings: {},
}));

vi.mock('@/lib/cache/index', () => {
  const store = new Map<string, { value: number; expires: number }>();

  return {
    cache: {
      incr: vi.fn(async (key: string, ttl: number) => {
        const existing = store.get(key);
        const newVal = (existing?.value || 0) + 1;
        store.set(key, { value: newVal, expires: Date.now() + ttl * 1000 });
        return newVal;
      }),
      get: vi.fn(async (key: string) => {
        const entry = store.get(key);
        if (!entry || entry.expires < Date.now()) return null;
        return entry.value;
      }),
      del: vi.fn(async (key: string) => {
        store.delete(key);
      }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: vi.fn(async (key: string, value: any, ttl: number) => {
        store.set(key, { value, expires: Date.now() + ttl * 1000 });
      }),
    },
    default: {},
  };
});

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows requests within limit', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 5, window: 60 });

    const result = await limiter.check('test-key');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
    expect(result.reset).toBeGreaterThan(Date.now());
  });

  it('blocks requests over limit', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 2, window: 60 });

    await limiter.check('over-key');
    await limiter.check('over-key');
    const result = await limiter.check('over-key');

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('respects custom config per check', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 100, window: 60 });

    const result = await limiter.check('custom-key', { max: 1 });
    expect(result.allowed).toBe(true);

    const result2 = await limiter.check('custom-key', { max: 1 });
    expect(result2.allowed).toBe(false);
  });

  it('uses default config when no config provided', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter();

    for (let i = 0; i < 100; i++) {
      await limiter.check('default-key');
    }
    const result = await limiter.check('default-key');
    expect(result.allowed).toBe(false);
  });

  it('different keys are isolated', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 1, window: 60 });

    await limiter.check('key-a');
    expect((await limiter.check('key-a')).allowed).toBe(false);
    expect((await limiter.check('key-b')).allowed).toBe(true);
  });

  it('enforce() throws RateLimitError when exceeded', async () => {
    const { RateLimiter, RateLimitError } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 1, window: 60 });

    await limiter.enforce('enforce-key');
    await expect(limiter.enforce('enforce-key')).rejects.toThrow(RateLimitError);
  });

  it('enforce() returns result when within limit', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 5, window: 60 });

    const result = await limiter.enforce('good-key');
    expect(result.allowed).toBe(true);
  });

  it('RateLimitError contains result details', async () => {
    const { RateLimiter, RateLimitError } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 1, window: 60 });

    await limiter.enforce('err-key');
    try {
      await limiter.enforce('err-key');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect(e.result).toBeDefined();
      expect(e.result.allowed).toBe(false);
      expect(e.result.limit).toBe(1);
      expect(e.name).toBe('RateLimitError');
    }
  });

  it('reset() clears the counter', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 2, window: 60 });

    await limiter.check('reset-key');
    await limiter.check('reset-key');
    await limiter.reset('reset-key');

    const result = await limiter.check('reset-key');
    expect(result.allowed).toBe(true);
  });

  it('getStatus() returns current state without incrementing', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 5, window: 60 });

    await limiter.check('status-key');
    const status = await limiter.getStatus('status-key');

    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(4);
    expect(status.limit).toBe(5);

    const afterStatus = await limiter.check('status-key');
    expect(afterStatus.remaining).toBe(3);
  });

  it('getStatus() returns full limit for unknown key', async () => {
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 10, window: 60 });

    const status = await limiter.getStatus('new-key');
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(10);
  });
});

describe('Pre-configured limiters', () => {
  it('exports standard limiters with correct config', async () => {
    const { limiters } = await import('@/lib/rate-limit');
    expect(limiters.api).toBeDefined();
    expect(limiters.auth).toBeDefined();
    expect(limiters.export).toBeDefined();
    expect(limiters.import).toBeDefined();
    expect(limiters.ai).toBeDefined();
    expect(limiters.webhook).toBeDefined();
    expect(limiters.passwordReset).toBeDefined();
    expect(limiters.emailVerification).toBeDefined();
    expect(limiters.contacts).toBeDefined();
    expect(limiters.deals).toBeDefined();
    expect(limiters.bulk).toBeDefined();
  });
});

describe('getRateLimitHeaders', () => {
  it('returns correct headers when allowed', async () => {
    const { getRateLimitHeaders } = await import('@/lib/rate-limit');

    const headers = getRateLimitHeaders({
      allowed: true,
      remaining: 57,
      reset: Date.now() + 60000,
      limit: 60,
    });

    expect(headers['X-RateLimit-Limit']).toBe('60');
    expect(headers['X-RateLimit-Remaining']).toBe('57');
    expect(headers['X-RateLimit-Reset']).toBeDefined();
    expect(headers['Retry-After']).toBe('0');
  });

  it('sets Retry-After when blocked', async () => {
    const { getRateLimitHeaders } = await import('@/lib/rate-limit');

    const headers = getRateLimitHeaders({
      allowed: false,
      remaining: 0,
      reset: Date.now() + 30000,
      limit: 60,
    });

    expect(headers['Retry-After']).not.toBe('0');
    expect(parseInt(headers['Retry-After']!)).toBeGreaterThan(0);
  });
});

describe('createLimiter', () => {
  it('creates a new RateLimiter with given config', async () => {
    const { createLimiter, RateLimiter } = await import('@/lib/rate-limit');

    const limiter = createLimiter({ max: 50, window: 30 });
    expect(limiter).toBeInstanceOf(RateLimiter);

    const result = await limiter.check('test');
    expect(result.limit).toBe(50);
  });
});

describe('rateLimitMiddleware', () => {
  it('uses IP when no auth header', async () => {
    const { rateLimitMiddleware } = await import('@/lib/rate-limit');
    const { RateLimiter } = await import('@/lib/rate-limit');

    const limiter = new RateLimiter({ max: 100, window: 60 });
    const request = new Request('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    const result = await rateLimitMiddleware(request, limiter, 'api');
    expect(result.allowed).toBe(true);
  });

  it('uses user identifier when auth header present', async () => {
    const { rateLimitMiddleware } = await import('@/lib/rate-limit');
    const { RateLimiter } = await import('@/lib/rate-limit');

    const limiter = new RateLimiter({ max: 100, window: 60 });
    const request = new Request('http://localhost/api/test', {
      headers: {
        'authorization': 'Bearer tok123',
        'x-forwarded-for': '1.2.3.4',
      },
    });

    const result = await rateLimitMiddleware(request, limiter, 'auth');
    expect(result.allowed).toBe(true);
  });

  it('defaults to api key prefix', async () => {
    const { rateLimitMiddleware } = await import('@/lib/rate-limit');
    const { RateLimiter } = await import('@/lib/rate-limit');

    const limiter = new RateLimiter({ max: 100, window: 60 });
    const request = new Request('http://localhost/api/test');

    const result = await rateLimitMiddleware(request, limiter);
    expect(result.allowed).toBe(true);
  });
});

describe('checkRateLimit (backwards compatibility)', () => {
  it('returns null when within limit', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = new Request('http://localhost/api/test');

    const result = await checkRateLimit(request, { action: 'test', max: 100, windowMinutes: 60 });
    expect(result).toBeNull();
  });

  it('returns 429 response when over limit', async () => {
    const { checkRateLimit, rateLimiter } = await import('@/lib/rate-limit');

    await rateLimiter.reset('v1_rate:default:unknown');
    const request = new Request('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });

    for (let i = 0; i < 101; i++) {
      await checkRateLimit(request);
    }

    const response = await checkRateLimit(request);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    const json = await response!.json();
    expect(json.error).toContain('Rate limit exceeded');
  });

  it('handles requests without headers', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const result = await checkRateLimit(null, { action: 'test' });
    expect(result).toBeNull();
  });
});

describe('default export', () => {
  it('exports default rateLimiter', async () => {
    const rateLimiter = (await import('@/lib/rate-limit')).default;
    expect(rateLimiter).toBeDefined();

    const result = await rateLimiter.check('default-test');
    expect(result.allowed).toBe(true);
  });
});
