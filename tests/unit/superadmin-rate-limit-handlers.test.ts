import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Handler-COUPLED rate-limit tests for the sensitive superadmin POST routes.
 *
 * Unlike tests/unit/rate-limit-coverage.test.ts (which exercises the shared
 * rateLimitMutating helper directly), these import the REAL route handlers and
 * drive them past their configured limit, asserting the over-limit call returns
 * HTTP 429. This is the property the review flagged as missing: if the
 * `rateLimitMutating(...)` guard line is deleted from a route, one of these
 * tests MUST fail (verified by temporarily removing a guard).
 */

// In-memory cache backing the RateLimiter (mirrors rate-limit-coverage.test.ts
// and scim-provision-rate-limit.test.ts).
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

// requireAuth resolves to a superadmin ctx so the handler passes the
// isSuperAdmin gate and reaches the rate-limit guard.
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    userId: 'admin-1',
    isSuperAdmin: true,
    user: { email: 'admin@example.com' },
  })),
}));

// withApiRoute wraps handlers in withPinnedConnection (RLS pinning, #1615).
// Stub the pinning primitive so the wrapper just runs the callback without a
// real pg pool.
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: vi.fn(async (fn: () => unknown) => fn()),
}));

// getRateLimit consults the DB first; return null lookups so checkRateLimit
// falls back to the hardcoded max in MUTATING_LIMITS.
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      systemSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      plans: { findFirst: vi.fn().mockResolvedValue(null) },
      users: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => []) })),
        innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(() => []) })) })) })),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  },
}));

// Mock @/drizzle/schema directly so importing a route does NOT transitively load
// the real drizzle/schema/*.ts files (which call relations() at module load).
vi.mock('@/drizzle/schema', () => ({
  users: { id: 'id', email: 'email', fullName: 'full_name' },
  tenantMembers: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', status: 'status', roleSlug: 'role_slug', joinedAt: 'joined_at' },
  roles: { id: 'id', tenantId: 'tenant_id', slug: 'slug' },
  selectiveRestoreLogs: { id: 'id', tenantId: 'tenant_id', backupId: 'backup_id', status: 'status', completedAt: 'completed_at', errorMessage: 'error_message' },
  selectiveRestoreAuditLog: {},
  superAdminBackups: {},
  plans: {},
  users_: {},
  systemSettings: {},
}));

// drizzle-orm operators used by the routes. `relations` MUST be present because
// mocked-away schema aside, some transitive imports still reference it.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((...args: unknown[]) => args),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
  relations: vi.fn(() => ({})),
}));

// Heavy side-effect deps the handlers pull in — stub so they never touch real
// infra. None of these run before the rate-limit guard, but importing the route
// loads them.
vi.mock('@/lib/auth/session', () => ({
  createToken: vi.fn(async () => 'tok'),
  setSessionCookie: vi.fn(async () => {}),
}));
vi.mock('@/lib/audit/super-admin', () => ({
  logSuperAdminAction: vi.fn(() => {}),
}));
vi.mock('@/lib/restore/restore-executor', () => ({
  rollbackToSnapshot: vi.fn(async () => {}),
  executeSelectiveRestore: vi.fn(async () => {}),
  validateTenant: vi.fn(async () => ({ valid: true })),
  createPreRestoreSnapshot: vi.fn(async () => 'snap-1'),
}));
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => {}),
}));

function post(url: string, ip: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('superadmin sensitive POST handlers — per-handler rate limit', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Distinct IPs only isolate buckets when the proxy is trusted; enable it so
    // each test's x-forwarded-for produces its own rate-limit key.
    process.env.TRUST_PROXY = 'true';
    const { cache } = await import('@/lib/cache/index');
    (cache as unknown as { __store: Map<string, number> }).__store.clear();
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it('impersonate: allows the first 5 POSTs then returns 429 on the 6th', async () => {
    const { POST } = await import('@/app/api/superadmin/impersonate/route');
    const ip = '203.0.113.11';
    // Body without tenantId → handler returns 400 when under limit (never 429),
    // so a 429 can ONLY come from the rate-limit guard.
    const under: Array<Response | undefined | void> = [];
    for (let i = 0; i < 5; i++) {
      under.push(await POST(post('http://localhost/api/superadmin/impersonate', ip, {}), undefined));
    }
    for (const r of under) {
      expect(r).toBeInstanceOf(NextResponse);
      expect((r as Response).status).not.toBe(429);
    }

    const over = (await POST(post('http://localhost/api/superadmin/impersonate', ip, {}), undefined)) as Response;
    expect(over.status).toBe(429);
  });

  it('selective-restore/rollback: allows the first 3 POSTs then returns 429 on the 4th', async () => {
    const { POST } = await import('@/app/api/superadmin/selective-restore/rollback/route');
    const ip = '203.0.113.12';
    // Empty body → schema validation returns 400 when under limit (never 429).
    const under: Array<Response | undefined | void> = [];
    for (let i = 0; i < 3; i++) {
      under.push(await POST(post('http://localhost/api/superadmin/selective-restore/rollback', ip, {}), undefined));
    }
    for (const r of under) {
      expect(r).toBeInstanceOf(NextResponse);
      expect((r as Response).status).not.toBe(429);
    }

    const over = (await POST(post('http://localhost/api/superadmin/selective-restore/rollback', ip, {}), undefined)) as Response;
    expect(over.status).toBe(429);
  });

  it('selective-restore/execute: allows the first 3 POSTs then returns 429 on the 4th (before SSE stream opens)', async () => {
    const { POST } = await import('@/app/api/superadmin/selective-restore/execute/route');
    const ip = '203.0.113.13';
    // Empty body → schema validation returns 400 when under limit (never 429).
    const under: Array<Response | undefined | void> = [];
    for (let i = 0; i < 3; i++) {
      under.push(await POST(post('http://localhost/api/superadmin/selective-restore/execute', ip, {}), undefined));
    }
    for (const r of under) {
      expect(r).toBeInstanceOf(NextResponse);
      expect((r as Response).status).not.toBe(429);
    }

    const over = (await POST(post('http://localhost/api/superadmin/selective-restore/execute', ip, {}), undefined)) as Response;
    expect(over.status).toBe(429);
  });

  it('rollback + execute share the selectiveRestore bucket (pooled 3/min budget)', async () => {
    const rollback = (await import('@/app/api/superadmin/selective-restore/rollback/route')).POST;
    const execute = (await import('@/app/api/superadmin/selective-restore/execute/route')).POST;
    const ip = '203.0.113.14';

    // 3 rollback calls exhaust the shared selectiveRestore budget...
    for (let i = 0; i < 3; i++) {
      await rollback(post('http://localhost/api/superadmin/selective-restore/rollback', ip, {}), undefined);
    }
    // ...so the next execute call from the same IP is already over-limit.
    const over = (await execute(post('http://localhost/api/superadmin/selective-restore/execute', ip, {}), undefined)) as Response;
    expect(over.status).toBe(429);
  });
});
