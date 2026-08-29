import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1615: routes/pages now run inside withPinnedConnection (via withApiRoute /
// withTenantScope). In unit tests there is no real pool, so stub the primitive
// to run the callback directly (matches tests/unit/auth-middleware-require-auth.test.ts).
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));


// Drizzle column objects expose their SQL name via `.name`; we assert on that
// rather than object identity to stay robust against module-graph re-evaluation
// under vi.doMock (the route re-imports the schema in the mocked graph).
const colName = (c: unknown) => (c as { name?: string })?.name;

/**
 * #1083 — route-level coverage for the leads GET where-clause composition.
 *
 * The zod schema layer (tests/unit/schemas.test.ts) proves that query params are
 * coerced/validated, but nothing exercised how app/api/tenant/leads/route.ts turns
 * those params into Drizzle filters. This test mocks the db and the Drizzle
 * operators so each operator returns an inspectable marker, then asserts which
 * filters the route composes for the tag contains-all and score-range paths.
 *
 * We do NOT stand up a real database: the operators are stubbed to plain objects
 * and the db chain is a spy that records the argument passed to `.where()`.
 */

// Markers returned by the stubbed operators so we can assert composition.
type FilterMarker = { op: string; args: unknown[] };

const mk = (op: string) => (...args: unknown[]): FilterMarker => ({ op, args });

// Captures the argument passed to the *first* `.where()` (the count query).
let capturedWhere: unknown;

function setup() {
  vi.resetModules();
  capturedWhere = undefined;

  // Admin context so `can(...)` short-circuits and no ownership filter is added.
  vi.doMock('@/lib/auth/middleware', () => ({
    requireAuth: vi.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      isAdmin: true,
      isSuperAdmin: false,
      permissions: {},
    }),
    can: vi.fn().mockReturnValue(true),
    requirePerm: vi.fn().mockReturnValue(null),
  }));

  // Keep the real drizzle-orm (schema files call `relations` at import time) but
  // override the operators the route uses so each returns an inspectable marker.
  // `and(...filters)` returns the raw filter list so we can inspect it directly.
  vi.doMock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('drizzle-orm')>();
    return {
      ...actual,
      eq: mk('eq'),
      or: mk('or'),
      desc: mk('desc'),
      ilike: mk('ilike'),
      isNull: mk('isNull'),
      gte: mk('gte'),
      lte: mk('lte'),
      arrayContains: mk('arrayContains'),
      and: (...filters: unknown[]) => ({ op: 'and', args: filters }),
    };
  });

  // db.select().from().leftJoin()....where()....offset() — a chainable spy.
  // The count query resolves to a rows array; the data query resolves to [].
  const makeChain = (result: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'leftJoin', 'orderBy', 'limit', 'offset']) {
      chain[m] = vi.fn(() => chain);
    }
    chain['where'] = vi.fn((arg: unknown) => {
      if (capturedWhere === undefined) capturedWhere = arg;
      return chain;
    });
    // Make the chain awaitable (the data query is awaited directly).
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
    return chain;
  };

  vi.doMock('@/drizzle/db', () => ({
    db: {
      select: vi
        .fn()
        // count query first
        .mockImplementationOnce(() => makeChain([{ count: 0 }]))
        // data query second
        .mockImplementationOnce(() => makeChain([])),
    },
  }));
  // The real @/drizzle/schema is used so filter columns are the actual Drizzle
  // column objects; assertions compare against those (imported below).
}

async function callGet(query: string) {
  const { GET } = await import('@/app/api/tenant/leads/route');
  const req = new Request(`http://localhost:3000/api/tenant/leads${query}`);
  const res = await GET(req as unknown as Parameters<typeof GET>[0]);
  return res;
}

function filters(): FilterMarker[] {
  expect(capturedWhere).toBeDefined();
  const where = capturedWhere as FilterMarker;
  expect(where.op).toBe('and');
  return where.args as FilterMarker[];
}

describe('GET /api/tenant/leads — where-clause composition (#1083)', () => {
  beforeEach(setup);

  it('composes an arrayContains filter with every requested tag (contains-all)', async () => {
    const res = await callGet('?tags=vip,%20enterprise%20,,gold');
    expect(res.status).toBe(200);

    const tagFilter = filters().find((f) => f.op === 'arrayContains');
    expect(tagFilter).toBeDefined();
    // Column first, then the trimmed, empty-stripped tag list.
    expect(colName(tagFilter!.args[0])).toBe('tags');
    expect(tagFilter!.args[1]).toEqual(['vip', 'enterprise', 'gold']);
  });

  it('does not add a tag filter when tags is absent', async () => {
    const res = await callGet('');
    expect(res.status).toBe(200);
    expect(filters().some((f) => f.op === 'arrayContains')).toBe(false);
  });

  it('composes gte and lte score filters for a score range', async () => {
    const res = await callGet('?score_min=20&score_max=80');
    expect(res.status).toBe(200);

    const composed = filters();
    const gteFilter = composed.find((f) => f.op === 'gte');
    const lteFilter = composed.find((f) => f.op === 'lte');

    expect(gteFilter).toBeDefined();
    expect(colName(gteFilter!.args[0])).toBe('score');
    expect(gteFilter!.args[1]).toBe(20);
    expect(lteFilter).toBeDefined();
    expect(colName(lteFilter!.args[0])).toBe('score');
    expect(lteFilter!.args[1]).toBe(80);
  });

  it('adds only a lower bound when only score_min is given', async () => {
    const res = await callGet('?score_min=50');
    expect(res.status).toBe(200);

    const composed = filters();
    const gteFilter = composed.find((f) => f.op === 'gte');
    expect(colName(gteFilter?.args[0])).toBe('score');
    expect(gteFilter?.args[1]).toBe(50);
    expect(composed.some((f) => f.op === 'lte')).toBe(false);
  });
});
