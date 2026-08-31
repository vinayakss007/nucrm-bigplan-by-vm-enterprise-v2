import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Handler-COUPLED rate-limit tests for the auth/AI POST routes.
 *
 * Unlike tests/unit/ai-auth-rate-limits.test.ts (which exercises the shared
 * checkRateLimit helper directly), these import the REAL POST handlers and drive
 * them past their configured limit, asserting the over-limit call returns HTTP
 * 429. Property under test: deleting the `checkRateLimit(...)` guard line from a
 * route MUST make one of these tests fail (verified by temporarily removing a
 * guard).
 */

// In-memory cache backing the RateLimiter.
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

// requireAuth -> valid tenant ctx; can(...) -> passes (needed by ai/score).
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    userId: 'user-1',
    tenantId: 'tenant-1',
    isSuperAdmin: false,
    user: { email: 'user@example.com' },
  })),
  can: vi.fn(() => true),
}));

// requireAiFeature returns null/falsy so the plan gate does NOT short-circuit.
vi.mock('@/lib/ai/plan-gate', () => ({
  requireAiFeature: vi.fn(async () => null),
  planHasFeature: vi.fn(async () => true),
}));

// withApiRoute wraps handlers in withPinnedConnection; stub it to just run the
// callback so no real pg pool is needed (ai/* routes use withApiRoute).
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: vi.fn(async (fn: () => unknown) => fn()),
}));

// accept-invite reads the session cookie via next/headers + verifyToken.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => (name === 'nucrm_session' ? { value: 'session-token' } : undefined)),
  })),
}));
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => ({ userId: 'user-1' })),
}));

// getRateLimit consults the DB first; null lookups -> checkRateLimit falls back
// to the hardcoded max passed by each route.
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      systemSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      plans: { findFirst: vi.fn().mockResolvedValue(null) },
      users: { findFirst: vi.fn().mockResolvedValue(null) },
      roles: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ then: (r: (v: unknown[]) => unknown) => r([]) })) })),
        where: vi.fn(() => ({ then: (r: (v: unknown[]) => unknown) => r([]) })),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  },
}));

// Mock @/drizzle/schema directly so importing a route does NOT transitively load
// the real drizzle/schema/*.ts files (which call relations() at module load).
vi.mock('@/drizzle/schema', () => ({
  contactScores: {},
  contacts: {},
  invitations: {},
  tenants: {},
  users: {},
  roles: {},
  tenantMembers: {},
  plans: {},
  systemSettings: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  gt: vi.fn((...args: unknown[]) => args),
  gte: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((...args: unknown[]) => args),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
  relations: vi.fn(() => ({})),
}));

// AI work libs — never reached before the guard, but importing the routes loads
// them. Stub so nothing touches a real model/gateway.
vi.mock('@/lib/ai/scoring', () => ({
  scoreLead: vi.fn(async () => ({ score: 0, reason: '', factors: [] })),
  bulkScoreLeads: vi.fn(async () => []),
}));
vi.mock('@/lib/ai/sentiment', () => ({
  analyzeSentiment: vi.fn(async () => ({ label: 'neutral', score: 0 })),
  updateDealSentiment: vi.fn(async () => {}),
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

describe('auth/AI POST handlers — per-handler rate limit', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Distinct IPs only isolate buckets when the proxy is trusted.
    process.env.TRUST_PROXY = 'true';
    const { cache } = await import('@/lib/cache/index');
    (cache as unknown as { __store: Map<string, number> }).__store.clear();
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it('ai/score: allows the first 30 POSTs then returns 429 on the 31st', async () => {
    const { POST } = await import('@/app/api/tenant/ai/score/route');
    const ip = '198.51.100.1';
    // Empty body (no contact_id, no bulk) -> handler returns 400 when under
    // limit, so a 429 can ONLY come from the rate-limit guard.
    let last: Response | undefined;
    for (let i = 0; i < 30; i++) {
      last = (await POST(post('http://localhost/api/tenant/ai/score', ip, {}), undefined)) as Response;
    }
    expect(last).toBeDefined();
    expect(last!.status).not.toBe(429);

    const over = (await POST(post('http://localhost/api/tenant/ai/score', ip, {}), undefined)) as Response;
    expect(over.status).toBe(429);
  });

  it('ai/sentiment: allows the first 30 POSTs then returns 429 on the 31st', async () => {
    const { POST } = await import('@/app/api/tenant/ai/sentiment/route');
    const ip = '198.51.100.2';
    // Empty body (no text) -> handler returns 400 when under limit.
    let last: Response | undefined;
    for (let i = 0; i < 30; i++) {
      last = (await POST(post('http://localhost/api/tenant/ai/sentiment', ip, {}), undefined)) as Response;
    }
    expect(last).toBeDefined();
    expect(last!.status).not.toBe(429);

    const over = (await POST(post('http://localhost/api/tenant/ai/sentiment', ip, {}), undefined)) as Response;
    expect(over.status).toBe(429);
  });

  it('accept-invite: allows the first 10 POSTs then returns 429 on the 11th', async () => {
    const { POST } = await import('@/app/api/auth/accept-invite/route');
    const ip = '198.51.100.3';
    // Empty body -> schema validation returns 400 when under limit.
    let last: Response | undefined;
    for (let i = 0; i < 10; i++) {
      last = (await POST(post('http://localhost/api/auth/accept-invite', ip, {}))) as Response;
    }
    expect(last).toBeDefined();
    expect(last!.status).not.toBe(429);

    const over = (await POST(post('http://localhost/api/auth/accept-invite', ip, {}))) as Response;
    expect(over.status).toBe(429);
  });
});
