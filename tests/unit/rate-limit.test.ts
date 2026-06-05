/**
 * Rate Limiting Tests
 *
 * Tests the rate limiter configuration and behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cache module
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

  it('enforce() throws RateLimitError when exceeded', async () => {
    const { RateLimiter, RateLimitError } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 1, window: 60 });

    await limiter.enforce('enforce-key');

    await expect(limiter.enforce('enforce-key')).rejects.toThrow(RateLimitError);
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
});

describe('Pre-configured limiters', () => {
  it('exports standard limiters with correct config', async () => {
    const { limiters } = await import('@/lib/rate-limit');

    expect(limiters.api).toBeDefined();
    expect(limiters.auth).toBeDefined();
    expect(limiters.export).toBeDefined();
    expect(limiters.bulk).toBeDefined();
    expect(limiters.webhook).toBeDefined();
  });
});

describe('getRateLimitHeaders', () => {
  it('returns correct headers', async () => {
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
