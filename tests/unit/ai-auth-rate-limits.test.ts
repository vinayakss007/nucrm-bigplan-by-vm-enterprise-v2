import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cache module used by rate-limit.ts (in-memory Map incr)
vi.mock('@/lib/cache/index', () => {
  const store = new Map<string, number>();
  return {
    cache: {
      incr: vi.fn(async (key: string, _ttl?: number) => {
        const current = (store.get(key) || 0) + 1;
        store.set(key, current);
        return current;
      }),
      get: vi.fn(async (key: string) => store.get(key) || 0),
      del: vi.fn(async (key: string) => { store.delete(key); }),
      set: vi.fn(async () => {}),
      __store: store,
    },
  };
});

// Mock the drizzle db so getRateLimit finds NO configured limits and falls
// back to the provided `max`. systemSettings/plans findFirst -> null means
// getRateLimit returns 0, so checkRateLimit uses the fallback max.
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      systemSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      plans: { findFirst: vi.fn().mockResolvedValue(null) },
      users: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  },
}));

vi.mock('@/drizzle/schema', () => ({
  plans: {},
  users: {},
  systemSettings: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

function makeRequest(ip: string): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('lib/rate-limit checkRateLimit — accept-invite / ai_score / ai_sentiment', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { cache } = await import('@/lib/cache/index');
    const store = (cache as unknown as { __store: Map<string, number> }).__store;
    store.clear();
  });

  it("accept-invite: returns null under the limit (max 10)", async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = makeRequest('203.0.113.1');

    const result = await checkRateLimit(request, { action: 'accept-invite', max: 10, windowMinutes: 15 });
    expect(result).toBeNull();
  });

  it("accept-invite: returns 429 once the limit (max 10) is exceeded", async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = makeRequest('203.0.113.2');

    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(await checkRateLimit(request, { action: 'accept-invite', max: 10, windowMinutes: 15 }));
    }

    // First 10 allowed
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toBeNull();
    }
    // 11th over the limit
    expect(results[10]).not.toBeNull();
    expect(results[10]!.status).toBe(429);
  });

  it("ai_score: returns null under the limit (max 30)", async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = makeRequest('203.0.113.3');

    const result = await checkRateLimit(request, { action: 'ai_score', max: 30, windowMinutes: 60 });
    expect(result).toBeNull();
  });

  it("ai_score: returns 429 once the limit (max 30) is exceeded", async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = makeRequest('203.0.113.4');

    const results = [];
    for (let i = 0; i < 31; i++) {
      results.push(await checkRateLimit(request, { action: 'ai_score', max: 30, windowMinutes: 60 }));
    }

    for (let i = 0; i < 30; i++) {
      expect(results[i]).toBeNull();
    }
    expect(results[30]).not.toBeNull();
    expect(results[30]!.status).toBe(429);
  });

  it("ai_sentiment: returns null under the limit (max 30)", async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = makeRequest('203.0.113.5');

    const result = await checkRateLimit(request, { action: 'ai_sentiment', max: 30, windowMinutes: 60 });
    expect(result).toBeNull();
  });

  it("ai_sentiment: returns 429 once the limit (max 30) is exceeded", async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = makeRequest('203.0.113.6');

    const results = [];
    for (let i = 0; i < 31; i++) {
      results.push(await checkRateLimit(request, { action: 'ai_sentiment', max: 30, windowMinutes: 60 }));
    }

    for (let i = 0; i < 30; i++) {
      expect(results[i]).toBeNull();
    }
    expect(results[30]).not.toBeNull();
    expect(results[30]!.status).toBe(429);
  });
});
