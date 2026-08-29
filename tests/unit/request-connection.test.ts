/**
 * Unit tests for the per-request connection pinning primitive (#1615).
 *
 * These exercise the real lib/db/request-connection.ts code path with a mocked
 * pool/client (mirroring how tests/unit/rls.test.ts mocks the data layer):
 *   - withPinnedConnection acquires ONE client and exposes it via getPinnedClient()
 *     INSIDE the callback, and getPinnedClient() is undefined OUTSIDE.
 *   - the finally block issues the tenant-GUC reset and releases the client.
 *   - a nested withPinnedConnection reuses the already-pinned client (one
 *     connection per request).
 *   - under PGBOUNCER_ENABLED=true it is a NO-OP: no client acquired/pinned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('@/lib/db/pool', () => ({
  getPool: vi.fn(() => mockPool),
}));

describe('db/request-connection (#1615 pinning primitive)', () => {
  const originalPgBouncer = process.env['PGBOUNCER_ENABLED'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['PGBOUNCER_ENABLED'];
  });

  afterEach(() => {
    if (originalPgBouncer === undefined) delete process.env['PGBOUNCER_ENABLED'];
    else process.env['PGBOUNCER_ENABLED'] = originalPgBouncer;
  });

  it('pins a client inside the callback and clears it outside', async () => {
    const { withPinnedConnection, getPinnedClient } = await import('@/lib/db/request-connection');

    expect(getPinnedClient()).toBeUndefined();

    let insideClient: unknown;
    await withPinnedConnection(async () => {
      insideClient = getPinnedClient();
    });

    expect(insideClient).toBe(mockClient);
    expect(getPinnedClient()).toBeUndefined();
    expect(mockPool.connect).toHaveBeenCalledTimes(1);
  });

  it('resets the tenant GUCs and releases the client in the finally block', async () => {
    const { withPinnedConnection } = await import('@/lib/db/request-connection');

    await withPinnedConnection(async () => { /* no-op */ });

    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const resetSql = mockClient.query.mock.calls[0][0] as string;
    expect(resetSql).toContain("set_config('app.current_tenant', '', false)");
    expect(resetSql).toContain("set_config('app.current_user', '', false)");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client even when the callback throws, and propagates the error', async () => {
    const { withPinnedConnection } = await import('@/lib/db/request-connection');

    await expect(
      withPinnedConnection(async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(1); // reset still issued
  });

  it('reuses the already-pinned client for nested calls (one connection per request)', async () => {
    const { withPinnedConnection, getPinnedClient } = await import('@/lib/db/request-connection');

    await withPinnedConnection(async () => {
      const outer = getPinnedClient();
      await withPinnedConnection(async () => {
        expect(getPinnedClient()).toBe(outer);
      });
    });

    // Only one physical connection acquired despite nesting.
    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    // Nested call did not acquire/release a second client; release happens once
    // when the outer scope unwinds.
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('is a no-op under PgBouncer: no client acquired or pinned', async () => {
    process.env['PGBOUNCER_ENABLED'] = 'true';
    const { withPinnedConnection, getPinnedClient } = await import('@/lib/db/request-connection');

    let insideClient: unknown = 'sentinel';
    const result = await withPinnedConnection(async () => {
      insideClient = getPinnedClient();
      return 42;
    });

    expect(result).toBe(42);
    expect(insideClient).toBeUndefined();
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockClient.release).not.toHaveBeenCalled();
  });
});
