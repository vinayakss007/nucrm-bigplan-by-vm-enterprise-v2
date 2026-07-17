/**
 * Database mock for tests that need DB access.
 * Call vi.mock('@/drizzle/db') before importing modules that use the DB.
 *
 * The chain is a thenable: `await mockDb` resolves to `resolver()` (default []).
 * In tests, set `mockResolver(() => [{ count: 0 }])` for count queries or
 * `mockResolver(() => [{ id: '1', ... }])` for list queries.
 * Restore with `mockResolver()` (resets to default []).
 */
import { vi } from 'vitest';

// ── Resolver (controls what `await db.select()...` returns) ──
type ResolverFn = () => unknown[];

let _resolver: ResolverFn = () => [];

/** Set the return value for the next `await db.select()...chain`. Pass no args to reset to `[]`. */
export function mockResolver(fn?: ResolverFn) {
  _resolver = fn ?? (() => []);
}

function _resolve() {
  return Promise.resolve(_resolver());
}

// ── Mock DB (thenable) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockDb(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    query: {
      contacts: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      users: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      deals: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      tasks: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      tenants: { findFirst: vi.fn().mockResolvedValue({ id: 't1', planId: 'free' }) },
      companies: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      leads: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      meetings: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      activities: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      tickets: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      modules: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      tenantModules: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      settings: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      plans: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      backups: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      integrations: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      supportTickets: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      webhooks: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn(async (cb: any) => cb(db)),
  };

  // Thenable: `await mockDb` resolves to resolver()
  db.then = (onfulfilled?: (v: unknown) => unknown) => _resolve().then(onfulfilled);

  return db;
}

export const mockDb = createMockDb();
