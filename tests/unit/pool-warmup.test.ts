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
});
