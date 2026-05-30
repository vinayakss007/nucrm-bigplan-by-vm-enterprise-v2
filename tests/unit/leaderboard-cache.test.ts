import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cache module
vi.mock('@/lib/cache/redis', () => ({
  withCache: vi.fn(async (_key: string, fetcher: () => Promise<any>, _ttl?: number) => {
    return fetcher();
  }),
}));

// Mock the db module
vi.mock('@/drizzle/db', () => ({
  db: {
    execute: vi.fn().mockResolvedValue([]),
  },
}));

// Mock auth and modules
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({ tenantId: 'tenant-123', userId: 'user-1' }),
}));

vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn().mockResolvedValue(null),
}));

import { withCache } from '@/lib/cache/redis';
import { GET } from '@/app/api/tenant/leaderboards/route';

describe('Leaderboard Cache Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls withCache with correct cache key pattern and no dynamic endDate for non-custom periods', async () => {
    const req = new Request('http://localhost/api/tenant/leaderboards?metric=deals_won&period=month');

    await GET(req as any);

    expect(withCache).toHaveBeenCalledTimes(1);
    const [key, , ttl] = (withCache as any).mock.calls[0];
    expect(key).toMatch(/^leaderboard:tenant-123:deals_won:month:/);
    // For non-custom periods, the key should end with an empty string segment (no endDate)
    expect(key).toMatch(/:$/);
    expect(ttl).toBe(300);
  });

  it('includes metric and period in cache key', async () => {
    const req = new Request('http://localhost/api/tenant/leaderboards?metric=revenue&period=quarter');

    await GET(req as any);

    const [key] = (withCache as any).mock.calls[0];
    expect(key).toContain(':revenue:');
    expect(key).toContain(':quarter:');
  });

  it('uses 300 second TTL for caching', async () => {
    const req = new Request('http://localhost/api/tenant/leaderboards?metric=activities&period=week');

    await GET(req as any);

    const [, , ttl] = (withCache as any).mock.calls[0];
    expect(ttl).toBe(300);
  });

  it('returns ranked data from the cache/fetcher', async () => {
    const mockWithCache = withCache as any;
    mockWithCache.mockResolvedValueOnce([
      { userId: 'u1', name: 'Alice', value: 10, rank: 1 },
      { userId: 'u2', name: 'Bob', value: 5, rank: 2 },
    ]);

    const req = new Request('http://localhost/api/tenant/leaderboards?metric=deals_won&period=month');
    const res = await GET(req as any);
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe('Alice');
    expect(body.data[0].rank).toBe(1);
    expect(body.metric).toBe('deals_won');
    expect(body.period).toBe('month');
  });

  it('includes date range in cache key for custom period', async () => {
    const req = new Request(
      'http://localhost/api/tenant/leaderboards?metric=conversion&period=custom&start=2024-01-01&end=2024-03-31'
    );

    await GET(req as any);

    const [key] = (withCache as any).mock.calls[0];
    expect(key).toContain(':conversion:custom:');
    expect(key).toContain('2024-01-01');
    expect(key).toContain('2024-03-31');
  });
});
