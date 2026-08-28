import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('@/lib/db/client', () => ({ query: mockQuery }));

describe('ensureSchema', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    // vitest v4: restoreAllMocks no longer clears call history on plain vi.fn()
    mockQuery.mockReset();
  });

  it('returns ready=true when all required tables exist', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { tablename: 'users' }, { tablename: 'sessions' }, { tablename: 'tenants' },
        { tablename: 'plans' }, { tablename: 'contacts' }, { tablename: 'deals' },
        { tablename: 'tasks' }, { tablename: 'companies' }, { tablename: 'activities' },
        { tablename: 'notifications' },
      ],
    });
    const { ensureSchema } = await import('@/lib/db/ensure-schema');
    const result = await ensureSchema();
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns missing tables when some do not exist', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ tablename: 'users' }, { tablename: 'tenants' }],
    });
    const { ensureSchema } = await import('@/lib/db/ensure-schema');
    const result = await ensureSchema();
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('deals');
    expect(result.missing).toContain('contacts');
  });

  it('caches a successful check within the TTL', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { tablename: 'users' }, { tablename: 'sessions' }, { tablename: 'tenants' },
        { tablename: 'plans' }, { tablename: 'contacts' }, { tablename: 'deals' },
        { tablename: 'tasks' }, { tablename: 'companies' }, { tablename: 'activities' },
        { tablename: 'notifications' },
      ],
    });
    const { ensureSchema } = await import('@/lib/db/ensure-schema');
    await ensureSchema();
    await ensureSchema();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('re-queries after the cache TTL elapses (detects a later migration)', async () => {
    vi.useFakeTimers();
    try {
      mockQuery.mockResolvedValue({
        rows: [
          { tablename: 'users' }, { tablename: 'sessions' }, { tablename: 'tenants' },
          { tablename: 'plans' }, { tablename: 'contacts' }, { tablename: 'deals' },
          { tablename: 'tasks' }, { tablename: 'companies' }, { tablename: 'activities' },
          { tablename: 'notifications' },
        ],
      });
      const { ensureSchema } = await import('@/lib/db/ensure-schema');

      const first = await ensureSchema();
      expect(first.ready).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Within the TTL: served from cache, no new query.
      await ensureSchema();
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Advance past the 60s TTL: the next call must re-query.
      vi.advanceTimersByTime(60_000 + 1);
      await ensureSchema();
      expect(mockQuery).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache when tables are missing', async () => {
    mockQuery.mockResolvedValue({ rows: [{ tablename: 'users' }] });
    const { ensureSchema } = await import('@/lib/db/ensure-schema');
    await ensureSchema();
    await ensureSchema();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('handles DB errors gracefully', async () => {
    mockQuery.mockRejectedValue(new Error('Connection refused'));
    const { ensureSchema } = await import('@/lib/db/ensure-schema');
    const result = await ensureSchema();
    expect(result.ready).toBe(false);
    expect(result.missing[0]).toContain('db_connection_failed');
  });
});
