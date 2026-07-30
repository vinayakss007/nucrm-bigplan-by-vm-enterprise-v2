/**
 * Tests for lib/db/query-timeout.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    connect: mockConnect,
  }),
}));

describe('query-timeout', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockReset();

    const fakeClient = {
      query: mockQuery,
      release: mockRelease,
    };
    mockConnect.mockResolvedValue(fakeClient);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('sets statement_timeout via SET LOCAL in a transaction', async () => {
    const { withTimeout } = await import('@/lib/db/query-timeout');

    await withTimeout(30_000, async (client) => {
      return client.query('SELECT 1');
    });

    // Should have: BEGIN, SET LOCAL, user query, COMMIT
    expect(mockQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockQuery).toHaveBeenCalledWith("SET LOCAL statement_timeout = '30000'");
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
    expect(mockQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back on error and still releases client', async () => {
    const { withTimeout } = await import('@/lib/db/query-timeout');

    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'SELECT 1') throw new Error('timeout!');
      return Promise.resolve({ rows: [] });
    });

    await expect(
      withTimeout(5_000, async (client) => client.query('SELECT 1'))
    ).rejects.toThrow('timeout!');

    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockRelease).toHaveBeenCalled();
  });

  it('always releases the client even on BEGIN failure', async () => {
    const { withTimeout } = await import('@/lib/db/query-timeout');

    mockQuery.mockRejectedValueOnce(new Error('connection dead'));

    await expect(
      withTimeout(5_000, async (client) => client.query('SELECT 1'))
    ).rejects.toThrow('connection dead');

    expect(mockRelease).toHaveBeenCalled();
  });

  it('queryWithTimeout is a convenience for single queries', async () => {
    const { queryWithTimeout } = await import('@/lib/db/query-timeout');

    mockQuery.mockResolvedValue({ rows: [{ n: 1 }], rowCount: 1 });

    const result = await queryWithTimeout(60_000, 'SELECT $1::int AS n', [1]);
    expect(result.rows).toEqual([{ n: 1 }]);
  });

  it('rounds and clamps timeout to at least 1ms', async () => {
    const { withTimeout } = await import('@/lib/db/query-timeout');

    await withTimeout(0.5, async (client) => client.query('SELECT 1'));

    expect(mockQuery).toHaveBeenCalledWith("SET LOCAL statement_timeout = '1'");
  });

  it('TIMEOUTS constants are exported', async () => {
    const { TIMEOUTS } = await import('@/lib/db/query-timeout');
    expect(TIMEOUTS.FAST).toBe(3_000);
    expect(TIMEOUTS.NORMAL).toBe(10_000);
    expect(TIMEOUTS.REPORT).toBe(60_000);
    expect(TIMEOUTS.BULK).toBe(120_000);
  });
});
