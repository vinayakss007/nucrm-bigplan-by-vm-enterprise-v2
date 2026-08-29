/**
 * Unit proof that the global `db` proxy routes to the PINNED client when a
 * connection is pinned, and to the POOL-bound instance otherwise (#1615).
 *
 * This is the DB-free demonstration of the connection-affinity fix. It stands in
 * for the live-DB integration test (tests/integration/rls-connection-affinity.test.ts)
 * when no Postgres is reachable:
 *
 *   FAIL-WITHOUT-FIX: before the fix, drizzle/db.ts always returned the
 *   pool-bound instance (getDb()), regardless of any pinned client. A query
 *   issued after setTenantContext(no tx) therefore ran on a different pooled
 *   connection with an empty tenant GUC → fail-closed RLS → zero rows. In this
 *   test that corresponds to the proxy ALWAYS delegating to the pool instance
 *   even when a client is pinned — the assertion `usedInstance === pinnedInstance`
 *   would be FALSE.
 *
 *   PASS-WITH-FIX: the proxy consults getPinnedClient() and, when a client is
 *   pinned, delegates to a drizzle instance bound to THAT client — so the query
 *   runs on the same connection the tenant GUC was set on.
 *
 * We mock `drizzle-orm/node-postgres` so each drizzle() call returns a uniquely
 * tagged fake instance, and mock getPool()/getPinnedClient() to control routing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakePool = { __kind: 'pool' };
const fakePinnedClient = { __kind: 'pinned-client' };

let pinnedClient: unknown = undefined;

vi.mock('../../lib/db/pool', () => ({
  getPool: vi.fn(() => fakePool),
}));

vi.mock('../../lib/db/request-connection', () => ({
  getPinnedClient: vi.fn(() => pinnedClient),
}));

// Each drizzle(conn) returns a tagged object recording which connection it was
// bound to, and a spy `execute` so we can assert which instance a query hit.
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn((conn: { __kind: string }) => ({
    __boundTo: conn.__kind,
    execute: vi.fn(async () => ({ rows: [{ boundTo: conn.__kind }] })),
  })),
}));

describe('db proxy connection-affinity routing (#1615)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    pinnedClient = undefined;
  });

  it('routes to the pool-bound instance when NO connection is pinned', async () => {
    pinnedClient = undefined;
    const { db } = await import('../../drizzle/db');
    // Access a property through the proxy to resolve the underlying instance.
    expect((db as unknown as { __boundTo: string }).__boundTo).toBe('pool');
  });

  it('routes to the PINNED client instance when a connection is pinned', async () => {
    pinnedClient = fakePinnedClient;
    const { db } = await import('../../drizzle/db');
    expect((db as unknown as { __boundTo: string }).__boundTo).toBe('pinned-client');
  });

  it('flips routing dynamically based on the pinned-client presence', async () => {
    const { db } = await import('../../drizzle/db');

    pinnedClient = undefined;
    expect((db as unknown as { __boundTo: string }).__boundTo).toBe('pool');

    pinnedClient = fakePinnedClient;
    expect((db as unknown as { __boundTo: string }).__boundTo).toBe('pinned-client');

    // This is the assertion that would FAIL on the unfixed code (which always
    // resolved to 'pool'): with a client pinned, the resolved instance is the
    // pinned client's, NOT the pool's.
    expect((db as unknown as { __boundTo: string }).__boundTo).not.toBe('pool');
  });
});
