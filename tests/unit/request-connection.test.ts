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

    // The pinned client is a transparent serialization wrapper over the
    // acquired client (per-pinned-client query serialization), so it is defined
    // and delegates to mockClient rather than being it by reference identity.
    expect(insideClient).toBeDefined();
    await (insideClient as { query: (sql: string) => Promise<unknown> }).query('SELECT 42');
    expect(mockClient.query).toHaveBeenCalledWith('SELECT 42');
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

  it('serializes concurrent queries on the pinned client (no overlap)', async () => {
    // Model node-postgres' one-in-flight-query-per-client rule: track how many
    // queries are executing simultaneously and fail if it ever exceeds 1.
    let inFlight = 0;
    let maxInFlight = 0;
    const serializedClient = {
      query: vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield to the event loop so a truly-concurrent second query would
        // overlap here if serialization were absent.
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(serializedClient);

    const { withPinnedConnection, getPinnedClient } = await import('@/lib/db/request-connection');

    await withPinnedConnection(async () => {
      const client = getPinnedClient() as { query: (sql: string) => Promise<unknown> };
      // Fire three queries WITHOUT awaiting between them — the fire-and-forget
      // pattern that caused the pg "already executing a query" warning.
      const p1 = client.query('SELECT 1');
      const p2 = client.query('SELECT 2');
      const p3 = client.query('SELECT 3');
      await Promise.all([p1, p2, p3]);
    });

    // If serialization works, no two queries ever ran at once.
    expect(maxInFlight).toBe(1);
    // All three data queries executed (plus the teardown GUC reset).
    expect(serializedClient.query.mock.calls.filter((c) => String(c[0]).startsWith('SELECT ')).length)
      .toBeGreaterThanOrEqual(3);
  });

  it('drains in-flight queries before resetting GUCs and releasing (fire-and-forget safe)', async () => {
    const order: string[] = [];
    const ffClient = {
      query: vi.fn(async (sql: string) => {
        if (String(sql).includes('set_config')) {
          order.push('reset');
        } else {
          await new Promise((r) => setTimeout(r, 10));
          order.push('detached-query-done');
        }
        return { rows: [] };
      }),
      release: vi.fn(() => order.push('release')),
    };
    mockPool.connect.mockResolvedValueOnce(ffClient);

    const { withPinnedConnection, getPinnedClient } = await import('@/lib/db/request-connection');

    await withPinnedConnection(async () => {
      const client = getPinnedClient() as { query: (sql: string) => Promise<unknown> };
      // Launch a detached (never-awaited) query, mimicking fireWebhooks/
      // evaluateAutomations, then let the handler "return" immediately.
      void client.query('SELECT detached');
    });

    // Teardown must wait for the detached query to finish BEFORE the reset and
    // release — otherwise the reset/release would collide with an in-flight
    // query on the same connection.
    expect(order).toEqual(['detached-query-done', 'reset', 'release']);
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
