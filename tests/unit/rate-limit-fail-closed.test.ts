/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Fail-closed rate-limiting tests (#1834).
 *
 * Before this fix the limiter failed OPEN on infrastructure errors:
 *  - a DB error in getRateLimit() → returned 0 → treated as "disabled"
 *  - a Redis error → cache.incr() returned 0 → `0 <= max` → always allowed
 *
 * These tests prove the new behavior:
 *  - DB lookup error → RATE_LIMIT_LOOKUP_ERROR sentinel, callers apply
 *    FAIL_CLOSED_DEFAULT (throttle) instead of unlimited
 *  - Redis-down (incr returns 0) → RateLimiter.check falls back to an
 *    in-process counter and blocks after `max`, never fails open
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Toggle to make cache.incr() simulate a Redis outage (returns 0, like the
// real cache.incr swallow-and-return-0 path).
let simulateRedisDown = false;

vi.mock('@/lib/cache/index', () => {
  const store = new Map<string, number>();
  return {
    cache: {
      incr: vi.fn(async (key: string) => {
        if (simulateRedisDown) return 0; // Redis error path
        store.set(key, (store.get(key) || 0) + 1);
        return store.get(key)!;
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      del: vi.fn(async (key: string) => { store.delete(key); }),
      set: vi.fn(async () => {}),
    },
    default: {},
  };
});

// DB mock whose queries can be flipped to throw (simulate DB outage).
let simulateDbDown = false;
const throwIfDown = async () => {
  if (simulateDbDown) throw new Error('DB connection lost');
  return null;
};
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      plans: { findFirst: vi.fn(throwIfDown) },
      users: { findFirst: vi.fn(throwIfDown) },
      systemSettings: { findFirst: vi.fn(throwIfDown) },
    },
  },
}));
vi.mock('@/drizzle/schema', () => ({ plans: {}, users: {}, systemSettings: {} }));

beforeEach(() => {
  vi.clearAllMocks();
  simulateRedisDown = false;
  simulateDbDown = false;
});

describe('getRateLimit — lookup error signalling (#1834)', () => {
  it('returns 0 (disabled) when nothing is configured and DB is healthy', async () => {
    const { getRateLimit } = await import('@/lib/rate-limit');
    expect(await getRateLimit(null, 'api')).toBe(0);
  });

  it('returns RATE_LIMIT_LOOKUP_ERROR (-1) when the DB lookup throws', async () => {
    simulateDbDown = true;
    const { getRateLimit, RATE_LIMIT_LOOKUP_ERROR } = await import('@/lib/rate-limit');
    expect(await getRateLimit('plan-1', 'api')).toBe(RATE_LIMIT_LOOKUP_ERROR);
  });
});

describe('checkPlanRateLimit — fails closed on DB error (#1834)', () => {
  it('does NOT bypass when the limit lookup errors — applies FAIL_CLOSED_DEFAULT', async () => {
    simulateDbDown = true; // getRateLimit will error; hasUnlimitedRateLimit also errors → false
    const { checkPlanRateLimit, FAIL_CLOSED_DEFAULT } = await import('@/lib/rate-limit');

    const out = await checkPlanRateLimit('user-1', 'plan-1', 'api', 'test-failclosed');
    expect(out).not.toBeNull();
    expect(out!.bypassed).toBe(false);
    expect(out!.result.limit).toBe(FAIL_CLOSED_DEFAULT);
    expect(out!.result.allowed).toBe(true); // first request allowed, but under a real limit
  });

  it('still bypasses when an admin INTENTIONALLY configured 0 (DB healthy)', async () => {
    // DB healthy, nothing configured → getRateLimit returns 0 → intentional disable
    const { checkPlanRateLimit } = await import('@/lib/rate-limit');
    const out = await checkPlanRateLimit('user-2', null, 'api', 'test-disabled');
    expect(out!.bypassed).toBe(true);
  });
});

describe('RateLimiter.check — fails closed when Redis is down (#1834)', () => {
  it('blocks after max via in-process fallback when cache.incr returns 0', async () => {
    simulateRedisDown = true;
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 3, window: 60 });

    const key = 'redis-down-key';
    expect((await limiter.check(key)).allowed).toBe(true);  // 1
    expect((await limiter.check(key)).allowed).toBe(true);  // 2
    expect((await limiter.check(key)).allowed).toBe(true);  // 3
    const fourth = await limiter.check(key);
    expect(fourth.allowed).toBe(false);                     // 4 → blocked, not open
    expect(fourth.remaining).toBe(0);
  });

  it('does NOT fail open (unbounded) when the store is degraded', async () => {
    simulateRedisDown = true;
    const { RateLimiter } = await import('@/lib/rate-limit');
    const limiter = new RateLimiter({ max: 5, window: 60 });
    const key = 'flood-key';
    let allowedCount = 0;
    for (let i = 0; i < 50; i++) {
      if ((await limiter.check(key)).allowed) allowedCount++;
    }
    // With fail-open this would be 50; fail-closed caps it at max.
    expect(allowedCount).toBe(5);
  });
});

describe('checkRateLimit — fail closed on lookup error (#1834)', () => {
  it('enforces the caller fallback max even when the DB lookup errors', async () => {
    simulateDbDown = true;
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const req = new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': '9.9.9.9' } });

    // fallback max of 2 → 3rd request should 429
    expect(await checkRateLimit(req, { action: 'failclose-action', max: 2, windowMinutes: 1 })).toBeNull();
    expect(await checkRateLimit(req, { action: 'failclose-action', max: 2, windowMinutes: 1 })).toBeNull();
    const blocked = await checkRateLimit(req, { action: 'failclose-action', max: 2, windowMinutes: 1 });
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });
});
