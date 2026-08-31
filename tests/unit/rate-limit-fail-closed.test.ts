/*!
 * #1834 — rate limiting must FAIL CLOSED (deny), never fail open (allow),
 * when the config lookup or the counter store fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the cache backend so we can simulate a store failure ────────────────
// cache.incr() returns 0 when the Redis backend errors (see lib/cache/index.ts).
const cacheState = { incrReturn: 1 as number };
vi.mock('@/lib/cache/index', () => ({
  cache: {
    incr: vi.fn(async () => cacheState.incrReturn),
    get: vi.fn(async () => 0),
    del: vi.fn(async () => undefined),
  },
}));

// ── Mock the DB so getRateLimit's lookups can be made to throw ───────────────
const dbState = { throwOnLookup: false };
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      plans: { findFirst: vi.fn(async () => { if (dbState.throwOnLookup) throw new Error('db down'); return null; }) },
      systemSettings: { findFirst: vi.fn(async () => { if (dbState.throwOnLookup) throw new Error('db down'); return null; }) },
      users: { findFirst: vi.fn(async () => null) },
    },
  },
}));

const { RateLimiter, getRateLimit, FAIL_CLOSED_MAX } = await import('@/lib/rate-limit');

beforeEach(() => {
  cacheState.incrReturn = 1;
  dbState.throwOnLookup = false;
});

describe('#1834 rate limiter fails closed', () => {
  it('DENIES when the counter store fails (incr returns 0)', async () => {
    cacheState.incrReturn = 0; // simulate Redis error path
    const limiter = new RateLimiter({ max: 100, window: 60 });
    const result = await limiter.check('ip:1.2.3.4:api');
    expect(result.allowed).toBe(false);      // must NOT be allowed
    expect(result.remaining).toBe(0);
  });

  it('ALLOWS normally when the store works and under the limit', async () => {
    cacheState.incrReturn = 1;
    const limiter = new RateLimiter({ max: 100, window: 60 });
    const result = await limiter.check('ip:1.2.3.4:api');
    expect(result.allowed).toBe(true);
  });

  it('DENIES when over the limit', async () => {
    cacheState.incrReturn = 101;
    const limiter = new RateLimiter({ max: 100, window: 60 });
    const result = await limiter.check('ip:1.2.3.4:api');
    expect(result.allowed).toBe(false);
  });

  it('getRateLimit returns the fail-closed ceiling (not 0/disabled) on lookup error', async () => {
    dbState.throwOnLookup = true;
    const max = await getRateLimit('plan-123', 'api');
    expect(max).toBe(FAIL_CLOSED_MAX);
    expect(max).toBeGreaterThan(0); // 0 would mean "disabled" = fail open
  });

  it('getRateLimit returns 0 (disabled) only on a genuine, successful no-config lookup', async () => {
    dbState.throwOnLookup = false;
    const max = await getRateLimit(null, 'api');
    expect(max).toBe(0);
  });
});
