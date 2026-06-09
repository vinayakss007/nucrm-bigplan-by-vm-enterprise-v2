import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeRateLimiter, getRateLimitHeaders, shouldBypassRateLimit, BYPASS_PREFIXES } from '@/lib/rate-limit-edge';

describe('EdgeRateLimiter', () => {
  let limiter: EdgeRateLimiter;

  beforeEach(() => {
    limiter = new EdgeRateLimiter();
  });

  it('allows requests within limit', () => {
    const r1 = limiter.check('key1', 5, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(4);
    expect(r1.limit).toBe(5);

    const r2 = limiter.check('key1', 5, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(3);
  });

  it('blocks requests that exceed the limit', () => {
    limiter.check('exceed', 2, 60_000);
    limiter.check('exceed', 2, 60_000);
    const r3 = limiter.check('exceed', 2, 60_000);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it('uses default limits when not overridden', () => {
    const d = new EdgeRateLimiter(10, 60_000);
    for (let i = 0; i < 10; i++) {
      expect(d.check('dkey').allowed).toBe(true);
    }
    expect(d.check('dkey').allowed).toBe(false);
  });

  it('resets after window expires', () => {
    limiter = new EdgeRateLimiter(2, 50);
    limiter.check('reset-test', 2, 50);
    limiter.check('reset-test', 2, 50);
    expect(limiter.check('reset-test', 2, 50).allowed).toBe(false);
  });

  it('reset() clears a key', () => {
    limiter.check('rkey', 1, 60_000);
    expect(limiter.check('rkey', 1, 60_000).allowed).toBe(false);
    limiter.reset('rkey');
    expect(limiter.check('rkey', 1, 60_000).allowed).toBe(true);
  });

  it('clear() resets all keys', () => {
    limiter.check('a', 1, 60_000);
    limiter.check('b', 1, 60_000);
    limiter.clear();
    expect(limiter.size).toBe(0);
    expect(limiter.check('a', 1, 60_000).allowed).toBe(true);
  });

  it('tracks size correctly', () => {
    limiter.check('s1');
    limiter.check('s2');
    expect(limiter.size).toBe(2);
    limiter.reset('s1');
    expect(limiter.size).toBe(1);
  });

  it('different keys are isolated', () => {
    limiter.check('iso1', 1, 60_000);
    expect(limiter.check('iso2', 1, 60_000).allowed).toBe(true);
    expect(limiter.check('iso1', 1, 60_000).allowed).toBe(false);
  });

  it('uses default max and window when not provided', () => {
    const d = new EdgeRateLimiter();
    expect(d.check('default').limit).toBe(60);
  });

  it('first request returns correct remaining', () => {
    const r = limiter.check('first', 10, 60_000);
    expect(r.remaining).toBe(9);
  });

  it('returns correct reset timestamp', () => {
    const before = Date.now();
    const r = limiter.check('ts', 10, 60_000);
    expect(r.reset).toBeGreaterThanOrEqual(before + 60_000);
    expect(r.reset).toBeLessThanOrEqual(before + 60_000 + 100);
  });
});

describe('getRateLimitHeaders', () => {
  it('returns standard rate limit headers when allowed', () => {
    const h = getRateLimitHeaders({ allowed: true, remaining: 42, reset: Date.now() + 60_000, limit: 60 });
    expect(h['X-RateLimit-Limit']).toBe('60');
    expect(h['X-RateLimit-Remaining']).toBe('42');
    expect(h['X-RateLimit-Reset']).toBeDefined();
    expect(h['Retry-After']).toBe('0');
  });

  it('returns Retry-After > 0 when blocked', () => {
    const h = getRateLimitHeaders({ allowed: false, remaining: 0, reset: Date.now() + 30_000, limit: 60 });
    expect(parseInt(h['Retry-After']!)).toBeGreaterThan(0);
  });

  it('returns integer for X-RateLimit-Reset', () => {
    const reset = Date.now() + 60_000;
    const h = getRateLimitHeaders({ allowed: true, remaining: 10, reset, limit: 100 });
    expect(h['X-RateLimit-Reset']).toBe(Math.ceil(reset / 1000).toString());
  });
});

describe('shouldBypassRateLimit', () => {
  it('bypasses webhook paths', () => {
    expect(shouldBypassRateLimit('/api/webhooks/stripe')).toBe(true);
    expect(shouldBypassRateLimit('/api/webhooks/inbound')).toBe(true);
    expect(shouldBypassRateLimit('/api/webhooks/resend/callback')).toBe(true);
  });

  it('bypasses health and metrics endpoints', () => {
    expect(shouldBypassRateLimit('/api/health')).toBe(true);
    expect(shouldBypassRateLimit('/api/metrics')).toBe(true);
    expect(shouldBypassRateLimit('/api/keepalive')).toBe(true);
    expect(shouldBypassRateLimit('/api/cron')).toBe(true);
  });

  it('does not bypass regular API routes', () => {
    expect(shouldBypassRateLimit('/api/tenant/contacts')).toBe(false);
    expect(shouldBypassRateLimit('/api/auth/login')).toBe(false);
    expect(shouldBypassRateLimit('/api/tenant/deals')).toBe(false);
  });

  it('bypasses cron with sub-paths', () => {
    expect(shouldBypassRateLimit('/api/cron/daily')).toBe(true);
    expect(shouldBypassRateLimit('/api/cron/hourly/report')).toBe(true);
  });

  it('does not bypass root or other paths', () => {
    expect(shouldBypassRateLimit('/')).toBe(false);
    expect(shouldBypassRateLimit('/api')).toBe(false);
    expect(shouldBypassRateLimit('/api/unknown')).toBe(false);
  });
});

describe('BYPASS_PREFIXES', () => {
  it('contains expected bypass paths', () => {
    expect(BYPASS_PREFIXES).toContain('/api/webhooks/');
    expect(BYPASS_PREFIXES).toContain('/api/health');
    expect(BYPASS_PREFIXES).toContain('/api/metrics');
    expect(BYPASS_PREFIXES).toContain('/api/keepalive');
    expect(BYPASS_PREFIXES).toContain('/api/cron');
  });
});

describe('edgeLimiter singleton', () => {
  it('is a default EdgeRateLimiter instance', async () => {
    const mod = await import('@/lib/rate-limit-edge');
    expect(mod.edgeLimiter).toBeInstanceOf(EdgeRateLimiter);
    const r = mod.edgeLimiter.check('singleton', 10, 60_000);
    expect(r.allowed).toBe(true);
  });
});
