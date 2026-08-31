import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cache module used by rate-limit.ts
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

// Mock the drizzle db (needed by rate-limit.ts for DB-based limit lookups)
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

describe('lib/api/mutating-rate-limit', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the store between tests
    const { cache } = await import('@/lib/cache/index');
    const store = (cache as unknown as { __store: Map<string, number> }).__store;
    store.clear();
  });

  it('returns null (allowed) when under limit for bulk entity', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/bulk', {
      method: 'POST',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });

    const result = await rateLimitMutating(request, 'bulk', 'post');
    expect(result).toBeNull();
  });

  it('returns null (allowed) when under limit for billing entity', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/billing', {
      method: 'PATCH',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });

    const result = await rateLimitMutating(request, 'billing', 'patch');
    expect(result).toBeNull();
  });

  it('returns null (allowed) when under limit for backup entity', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/backup', {
      method: 'DELETE',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });

    const result = await rateLimitMutating(request, 'backup', 'delete');
    expect(result).toBeNull();
  });

  it('returns 429 response when over limit for backup (limit=3 for delete)', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/backup', {
      method: 'DELETE',
      headers: { 'x-forwarded-for': '10.10.10.10' },
    });

    // backup delete limit is 3 - call 4 times
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await rateLimitMutating(request, 'backup', 'delete'));
    }

    // First 3 should be null (allowed)
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();

    // 4th should be a 429 response
    expect(results[3]).not.toBeNull();
    expect(results[3]!.status).toBe(429);
  });

  it('uses correct limits for calendarSync entity', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/calendar-sync', {
      method: 'POST',
      headers: { 'x-forwarded-for': '172.16.0.1' },
    });

    // calendarSync post limit is 10 - first should pass
    const result = await rateLimitMutating(request, 'calendarSync', 'post');
    expect(result).toBeNull();
  });

  it('uses correct limits for apiKeys entity', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/api-keys', {
      method: 'DELETE',
      headers: { 'x-forwarded-for': '10.0.0.5' },
    });

    // apiKeys delete limit is 5 - first should pass
    const result = await rateLimitMutating(request, 'apiKeys', 'delete');
    expect(result).toBeNull();
  });

  it('uses correct limits for bulkTransfer entity', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/bulk-transfer', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.0.0.6' },
    });

    // bulkTransfer post limit is 3
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await rateLimitMutating(request, 'bulkTransfer', 'post'));
    }

    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
    expect(results[3]).not.toBeNull();
    expect(results[3]!.status).toBe(429);
  });

  it('returns null (allowed) then 429 over limit for impersonate (post limit=5)', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/superadmin/impersonate', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await rateLimitMutating(request, 'impersonate', 'post'));
    }

    // First 5 allowed
    expect(results[0]).toBeNull();
    expect(results[4]).toBeNull();
    // 6th over limit
    expect(results[5]).not.toBeNull();
    expect(results[5]!.status).toBe(429);
  });

  it('returns null (allowed) then 429 over limit for joinTenant (post limit=5)', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/superadmin/join-tenant', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.2' },
    });

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await rateLimitMutating(request, 'joinTenant', 'post'));
    }

    // First 5 allowed
    expect(results[0]).toBeNull();
    expect(results[4]).toBeNull();
    // 6th over limit
    expect(results[5]).not.toBeNull();
    expect(results[5]!.status).toBe(429);
  });

  it('returns null (allowed) then 429 over limit for selectiveRestore (post limit=3)', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/superadmin/selective-restore/execute', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.3' },
    });

    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await rateLimitMutating(request, 'selectiveRestore', 'post'));
    }

    // First 3 allowed
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
    // 4th over limit
    expect(results[3]).not.toBeNull();
    expect(results[3]!.status).toBe(429);
  });

  it('applies DEFAULT_LIMITS for unknown entities', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');

    const request = new Request('http://localhost/api/unknown', {
      method: 'PATCH',
      headers: { 'x-forwarded-for': '10.0.0.7' },
    });

    // Default patch limit is 30 - first should pass
    const result = await rateLimitMutating(request, 'unknownEntity', 'patch');
    expect(result).toBeNull();
  });
});
