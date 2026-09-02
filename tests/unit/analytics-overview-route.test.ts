import { describe, it, expect, vi, beforeEach } from 'vitest';

// F4 (#1544): GET /api/tenant/analytics/overview must return COMPACT server-side
// aggregates computed over the full tenant dataset instead of raw row arrays.
// These tests mock @/drizzle/db so each aggregate query returns canned rows and
// assert the reshaped output, numeric coercion of the decimal-as-string revenue,
// the tasks total/completed/open/overdue math, and the 8-bucket weekly fill.

const fakeCtx = { tenantId: 'tenant-123', userId: 'user-1' };
const mockRequireTenantCtx = vi.fn();

// The route fires six db.select(...) calls inside Promise.all, in this order:
//   0: deals-by-stage, 1: contacts-by-source, 2: contacts-by-status,
//   3: tasks aggregate, 4: contacts weekly, 5: deals weekly.
// Each returned builder is a thenable that resolves to the next queued result.
let selectResults: unknown[][] = [];
let selectCall = 0;
// Every builder records the predicate passed to its .where(...) so the tests can
// assert that each aggregate query keeps a filter (the tenant + soft-delete
// predicate). Dropping .where from any query would be a cross-tenant /
// soft-delete regression, so we lock down that each query applies one.
let whereCalls: unknown[] = [];

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'groupBy', 'orderBy', 'limit']) {
    builder[m] = chain;
  }
  // .where is a spy so we can assert a filter was applied per query. It still
  // returns the builder to keep the chain intact.
  builder['where'] = vi.fn((predicate: unknown) => {
    whereCalls.push(predicate);
    return builder;
  });
  // Awaiting the builder (Promise.all) resolves to the canned rows.
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

const mockDb = {
  select: vi.fn(() => {
    const rows = selectResults[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(rows);
  }),
};

vi.mock('@/lib/tenant/context', () => ({
  requireTenantCtx: (...args: unknown[]) => mockRequireTenantCtx(...args),
}));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T>(fn: T) => fn,
}));

// #1615: the route runs inside withPinnedConnection (via withApiRoute). In unit
// tests there is no real pool, so stub the primitive to run the callback
// directly — otherwise getPool().connect() throws ECONNREFUSED 127.0.0.1:5432.
// (matches tests/unit/conversion-funnel.test.ts, data-explorer.test.ts, etc.)
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

// Recursively search a drizzle SQL/predicate object for a bound string value,
// guarding against the circular table<->column references drizzle builds.
function containsValue(node: unknown, target: string, seen = new Set<unknown>()): boolean {
  if (node === target) return true;
  if (node === null || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (containsValue(value, target, seen)) return true;
  }
  return false;
}

function makeRequest() {
  return { headers: new Headers() } as unknown as import('next/server').NextRequest;
}

async function callRoute() {
  const { GET } = await import('@/app/api/tenant/analytics/overview/route');
  const res = await GET(makeRequest());
  return { res, json: await res.json() };
}

describe('GET /api/tenant/analytics/overview aggregate shape (#1544 F4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCall = 0;
    selectResults = [];
    whereCalls = [];
    mockRequireTenantCtx.mockResolvedValue(fakeCtx);
  });

  it('reshapes into compact aggregates and coerces string revenue to a number', async () => {
    selectResults = [
      // deals-by-stage (revenue arrives as a decimal-as-string from SUM(CAST ...))
      [
        { stageId: 's1', stageName: 'Won', count: 3, revenue: '15000.50' },
        { stageId: 's2', stageName: 'Lost', count: 2, revenue: '0' },
        { stageId: 's3', stageName: 'Qualified', count: 4, revenue: '8000' },
      ],
      // contacts-by-source (null source preserved for client-side default)
      [
        { source: 'Referral', count: 5 },
        { source: null, count: 2 },
      ],
      // contacts-by-status
      [
        { status: 'new', count: 6 },
        { status: null, count: 1 },
      ],
      // tasks aggregate
      [{ total: 10, completed: 6, overdue: 2 }],
      // contacts weekly buckets w0..w7
      [{ w0: 1, w1: 0, w2: 3, w3: 0, w4: 0, w5: 2, w6: 0, w7: 4 }],
      // deals weekly buckets w0..w7
      [{ w0: 0, w1: 1, w2: 0, w3: 0, w4: 5, w5: 0, w6: 0, w7: 2 }],
    ];

    const { res, json } = await callRoute();
    expect(res.status).toBe(200);

    // Aggregate shape — no raw row arrays, no pipelines/stages array.
    expect(json.data).toHaveProperty('deals.byStage');
    expect(json.data).toHaveProperty('contacts.bySource');
    expect(json.data).toHaveProperty('contacts.byStatus');
    expect(json.data).toHaveProperty('tasks');
    expect(json.data).toHaveProperty('timeseries.weekly');
    expect(Array.isArray(json.data.deals)).toBe(false);
    expect(json.data.pipelines).toBeUndefined();

    // Revenue summed from string amounts becomes a real number.
    const won = json.data.deals.byStage.find((s: { stageName: string }) => s.stageName === 'Won');
    expect(won).toEqual({ stageId: 's1', stageName: 'Won', count: 3, revenue: 15000.5 });
    expect(typeof won.revenue).toBe('number');
    const lost = json.data.deals.byStage.find((s: { stageName: string }) => s.stageName === 'Lost');
    expect(lost.revenue).toBe(0);

    // Contacts aggregates keep raw source/status (including null) + numeric count.
    expect(json.data.contacts.bySource).toEqual([
      { source: 'Referral', count: 5 },
      { source: null, count: 2 },
    ]);
    expect(json.data.contacts.byStatus).toEqual([
      { status: 'new', count: 6 },
      { status: null, count: 1 },
    ]);
  });

  it('computes tasks total/completed/open/overdue with open = total - completed', async () => {
    selectResults = [
      [],
      [],
      [],
      [{ total: 10, completed: 6, overdue: 2 }],
      [{}],
      [{}],
    ];

    const { json } = await callRoute();
    expect(json.data.tasks).toEqual({ total: 10, completed: 6, open: 4, overdue: 2 });
  });

  it('always fills exactly 8 weekly buckets with zeros for empty weeks', async () => {
    selectResults = [
      [],
      [],
      [],
      [{ total: 0, completed: 0, overdue: 0 }],
      // Sparse contacts weekly result — missing keys must default to 0.
      [{ w2: 3, w7: 4 }],
      // Empty deals weekly result — every bucket must be 0.
      [{}],
    ];

    const { json } = await callRoute();
    const weekly = json.data.timeseries.weekly;
    expect(weekly).toHaveLength(8);
    for (const w of weekly) {
      expect(typeof w.weekStart).toBe('string');
      expect(new Date(w.weekStart).toString()).not.toBe('Invalid Date');
      expect(typeof w.contacts).toBe('number');
      expect(typeof w.deals).toBe('number');
    }
    expect(weekly[2].contacts).toBe(3);
    expect(weekly[7].contacts).toBe(4);
    expect(weekly[0].contacts).toBe(0);
    expect(weekly.every((w: { deals: number }) => w.deals === 0)).toBe(true);

    // Buckets are ordered oldest -> newest (weekStart strictly increasing).
    for (let i = 1; i < weekly.length; i += 1) {
      expect(new Date(weekly[i].weekStart).getTime()).toBeGreaterThan(
        new Date(weekly[i - 1].weekStart).getTime(),
      );
    }
  });

  it('applies a where filter on every aggregate query so the tenant + soft-delete predicate cannot be silently dropped', async () => {
    selectResults = [
      [{ stageId: 's1', stageName: 'Won', count: 1, revenue: '100' }],
      [{ source: 'Referral', count: 1 }],
      [{ status: 'new', count: 1 }],
      [{ total: 1, completed: 0, overdue: 0 }],
      [{}],
      [{}],
    ];

    const { res } = await callRoute();
    expect(res.status).toBe(200);

    // The route issues six aggregate queries; each MUST apply a where clause.
    // If a regression removes the tenant / soft-delete filter from any query,
    // this count drops below 6 and the test fails.
    expect(mockDb.select).toHaveBeenCalledTimes(6);
    expect(whereCalls).toHaveLength(6);

    // Every predicate must be a real filter object (not undefined / no-op).
    for (const predicate of whereCalls) {
      expect(predicate).toBeTruthy();
      expect(typeof predicate).toBe('object');
    }

    // The tenant id from the mocked ctx must flow into the query path: drizzle
    // carries the eq(tenantId, ctx.tenantId) bind value inside the predicate.
    // Walk the predicate object (guarding against drizzle's circular table
    // refs) and assert the mocked tenant id appears as a bound value, without
    // depending on exact SQL string internals.
    for (const predicate of whereCalls) {
      expect(containsValue(predicate, fakeCtx.tenantId)).toBe(true);
    }
  });

  it('returns a 500 with the stable error shape when a query throws', async () => {
    mockDb.select.mockImplementationOnce(() => { throw new Error('db down'); });
    const { res, json } = await callRoute();
    expect(res.status).toBe(500);
    expect(json).toEqual({ error: 'Failed to fetch analytics data' });
  });
});
