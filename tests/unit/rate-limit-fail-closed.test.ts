/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1834 — rate limiting must FAIL CLOSED, never fail open, when the config
 * lookup or the counter store fails.
 *
 * Before this fix the limiter failed OPEN on infrastructure errors:
 *  - a DB error in getRateLimit() → returned 0 → treated as "disabled"
 *  - a Redis error → cache.incr() returned 0 → `0 <= max` → always allowed
 *
 * The reconciled implementation (see lib/rate-limit.ts) proves:
 *  - DB lookup error → getRateLimit returns FAIL_CLOSED_MAX (a real ceiling),
 *    never 0/"disabled"; callers therefore keep throttling instead of bypassing
 *  - Redis-down (cache.incr returns 0) → RateLimiter.check DENIES the request
 *    (non-positive counter == failed store read), never allows unbounded traffic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Cache mock ───────────────────────────────────────────────────────────────
// `simulateRedisDown` makes cache.incr() return 0, mirroring the real
// swallow-and-return-0 path in lib/cache/index.ts when Redis errors. Otherwise
// it counts per key so limiter enforcement can be exercised end to end.
let simulateRedisDown = false;
const cacheStore = new Map<string, number>();
vi.mock('@/lib/cache/index', () => ({
  cache: {
    incr: vi.fn(async (key: string) => {
      if (simulateRedisDown) return 0; // Redis error path
      cacheStore.set(key, (cacheStore.get(key) || 0) + 1);
      return cacheStore.get(key)!;
    }),
    get: vi.fn(async (key: string) => cacheStore.get(key) ?? 0),
    del: vi.fn(async (key: string) => { cacheStore.delete(key); }),
    set: vi.fn(async () => {}),
  },
  default: {},
}));

// ── DB mock ──────────────────────────────────────────────────────────────────
// `simulateDbDown` flips the lookups to throw (simulate a DB outage).
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

const {
  RateLimiter,
  getRateLimit,
  checkPlanRateLimit,
  checkRateLimit,
  FAIL_CLOSED_MAX,
} = await import('@/lib/rate-limit');

beforeEach(() => {
  vi.clearAllMocks();
  simulateRedisDown = false;
  simulateDbDown = false;
  cacheStore.clear();
});

describe('getRateLimit — fail closed on lookup error (#1834)', () => {
  it('returns 0 (disabled) only on a genuine, successful no-config lookup', async () => {
    expect(await getRateLimit(null, 'api')).toBe(0);
  });

  it('returns the FAIL_CLOSED_MAX ceiling (not 0/disabled) when the DB lookup throws', async () => {
    simulateDbDown = true;
    const max = await getRateLimit('plan-123', 'api');
    expect(max).toBe(FAIL_CLOSED_MAX);
    expect(max).toBeGreaterThan(0); // 0 would mean "disabled" = fail open
  });
});

describe('RateLimiter.check — fails closed on counter store failure (#1834)', () => {
  it('DENIES when the counter store fails (incr returns 0)', async () => {
    simulateRedisDown = true;
    const limiter = new RateLimiter({ max: 100, window: 60 });
    const result = await limiter.check('ip:1.2.3.4:api');
    expect(result.allowed).toBe(false); // must NOT be allowed
    expect(result.remaining).toBe(0);
  });

  it('ALLOWS normally when the store works and under the limit', async () => {
    const limiter = new RateLimiter({ max: 100, window: 60 });
    const result = await limiter.check('ip:1.2.3.4:api');
    expect(result.allowed).toBe(true);
  });

  it('DENIES when over the configured limit', async () => {
    const limiter = new RateLimiter({ max: 2, window: 60 });
    const key = 'ip:1.2.3.4:over';
    expect((await limiter.check(key)).allowed).toBe(true);  // 1
    expect((await limiter.check(key)).allowed).toBe(true);  // 2
    expect((await limiter.check(key)).allowed).toBe(false); // 3 → blocked
  });

  it('does NOT fail open (unbounded) when the store is degraded', async () => {
    simulateRedisDown = true;
    const limiter = new RateLimiter({ max: 5, window: 60 });
    const key = 'flood-key';
    let allowedCount = 0;
    for (let i = 0; i < 50; i++) {
      if ((await limiter.check(key)).allowed) allowedCount++;
    }
    // With fail-open this would be 50; fail-closed denies every degraded read.
    expect(allowedCount).toBe(0);
  });
});

describe('checkPlanRateLimit — fails closed on DB error (#1834)', () => {
  it('does NOT bypass when the limit lookup errors — applies FAIL_CLOSED_MAX', async () => {
    simulateDbDown = true; // getRateLimit errors; hasUnlimitedRateLimit also errors → false
    const out = await checkPlanRateLimit('user-1', 'plan-1', 'api', 'test-failclosed');
    expect(out).not.toBeNull();
    expect(out!.bypassed).toBe(false);
    expect(out!.result.limit).toBe(FAIL_CLOSED_MAX);
    expect(out!.result.allowed).toBe(true); // first request allowed, but under a real limit
  });

  it('still bypasses when an admin INTENTIONALLY configured 0 (DB healthy)', async () => {
    // DB healthy, nothing configured → getRateLimit returns 0 → intentional disable
    const out = await checkPlanRateLimit('user-2', null, 'api', 'test-disabled');
    expect(out!.bypassed).toBe(true);
  });
});

describe('checkRateLimit — fail closed on lookup error (#1834)', () => {
  it('enforces a real ceiling (FAIL_CLOSED_MAX) even when the DB lookup errors', async () => {
    simulateDbDown = true;
    const req = new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': '9.9.9.9' } });

    // Lookup error → getRateLimit returns FAIL_CLOSED_MAX (>0), so the request
    // is throttled at that ceiling rather than left unlimited. Under the ceiling
    // requests pass; once exceeded they 429.
    for (let i = 0; i < FAIL_CLOSED_MAX; i++) {
      expect(await checkRateLimit(req, { action: 'failclose-action' })).toBeNull();
    }
    const blocked = await checkRateLimit(req, { action: 'failclose-action' });
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });
});
