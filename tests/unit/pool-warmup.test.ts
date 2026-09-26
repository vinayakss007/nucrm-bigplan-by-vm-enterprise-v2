/**
 * Tests for lib/db/warmup.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease });

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    connect: mockConnect,
    options: { max: 10 },
  }),
}));

describe('pool-warmup', () => {
  beforeEach(() => {
    vi.resetModules();
    mockConnect.mockClear();
    mockQuery.mockClear();
    mockRelease.mockClear();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  });

  it('warms min(poolSize/2, 5) connections by default', async () => {
    const { warmPool } = await import('@/lib/db/warmup');
    const warmed = await warmPool();
    // pool max=10, so target = min(ceil(10/2), 5) = 5
    expect(warmed).toBe(5);
    expect(mockConnect).toHaveBeenCalledTimes(5);
    expect(mockQuery).toHaveBeenCalledTimes(5);
    expect(mockRelease).toHaveBeenCalledTimes(5);
  });

  it('respects explicit count', async () => {
    const { warmPool } = await import('@/lib/db/warmup');
    const warmed = await warmPool(3);
    expect(warmed).toBe(3);
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });

  it('handles connection failures gracefully', async () => {
    mockConnect.mockRejectedValueOnce(new Error('connection refused'));
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });

    const { warmPool } = await import('@/lib/db/warmup');
    const warmed = await warmPool(3);

    // 1 failed + 2 succeeded
    expect(warmed).toBe(2);
  });

  it('returns 0 when all connections fail', async () => {
    mockConnect.mockRejectedValue(new Error('DB down'));

    const { warmPool } = await import('@/lib/db/warmup');
    const warmed = await warmPool(3);
    expect(warmed).toBe(0);
  });

  it('each connection runs SELECT 1 to verify full readiness', async () => {
    const { warmPool } = await import('@/lib/db/warmup');
    await warmPool(2);
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('#674: retries the round when every failure is transient, then warms', async () => {
    let calls = 0;
    mockConnect.mockImplementation(async () => {
      calls++;
      if (calls <= 6) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      return { query: mockQuery, release: mockRelease };
    });

    const { warmPool } = await import('@/lib/db/warmup');
    const warmed = await warmPool(3, 5_000);

    // rounds 1-2 (3 each) failed transiently, round 3 succeeded
    expect(calls).toBe(9);
    expect(warmed).toBe(3);
  });

  it('#674: does not retry non-transient (config/auth) failures', async () => {
    const authErr = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    mockConnect.mockRejectedValue(authErr);

    const { warmPool } = await import('@/lib/db/warmup');
    const started = Date.now();
    const warmed = await warmPool(3, 5_000);

    expect(warmed).toBe(0);
    // exactly one round — no backoff loop for a deterministic failure
    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('#674: gives up at the deadline instead of looping forever', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'));

    const { warmPool } = await import('@/lib/db/warmup');
    const started = Date.now();
    const warmed = await warmPool(2, 400);

    expect(warmed).toBe(0);
    // deadline (400ms) + one in-flight round must bound total time well below
    // the 5s a naive fixed retry schedule would take
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it('returns 0 without touching the pool when it cannot even be constructed', async () => {
    const mockGetPool = vi.fn(() => {
      throw new Error('DATABASE_URL is required');
    });
    vi.doMock('@/lib/db/pool', () => ({ getPool: mockGetPool }));
    vi.resetModules();

    const { warmPool } = await import('@/lib/db/warmup');
    await expect(warmPool(2, 100)).resolves.toBe(0);
    vi.doUnmock('@/lib/db/pool');
  });
});
