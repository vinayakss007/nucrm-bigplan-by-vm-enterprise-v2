import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * /api/tenant/notifications/matrix writes the `matrix` key of
 * tenant_members.notification_prefs — the same jsonb column the flat prefs route
 * touches, hence the jsonb_set merge instead of an assignment.
 *
 * Its concurrency check used the 5-argument concurrencyGuard overload, which
 * matches on `table.id`. tenant_members.id is a surrogate key, and the route
 * passed ctx.userId into that slot, so the lookup could never find the row:
 * every request that sent expectedUpdatedAt answered 404 "Record not found"
 * rather than guarding anything.
 */

const mockCtx = { tenantId: 'tenant-1', userId: 'user-1' };
const mockRequireAuth = vi.fn();

let findFirstResult: unknown = null;
let updateResult: unknown[] = [];
let lastSetArg: Record<string, unknown> = {};
let lastWherePredicate: unknown = null;

const dialect = new PgDialect();
const toSql = (fragment: unknown) => dialect.sqlToQuery(fragment as never).sql;
const toParams = (fragment: unknown) => dialect.sqlToQuery(fragment as never).params;

function makeUpdateBuilder() {
  const b: Record<string, unknown> = {};
  b.set = (arg: Record<string, unknown>) => { lastSetArg = arg; return b; };
  b.where = (p: unknown) => { lastWherePredicate = p; return b; };
  b.returning = () => Promise.resolve(updateResult);
  return b;
}

const mockDb = {
  query: { tenantMembers: { findFirst: vi.fn(async () => findFirstResult) } },
  update: vi.fn(() => makeUpdateBuilder()),
};

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));

const { GET, PATCH } = await import('@/app/api/tenant/notifications/matrix/route');

type Req = import('next/server').NextRequest;
function request(body?: unknown): Req {
  return new Request('http://localhost/api/tenant/notifications/matrix', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as Req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(mockCtx);
  findFirstResult = {
    notificationPrefs: { matrix: {'deal.won': { in_app: true, email: false, telegram: false } } },
    updatedAt: new Date('2026-03-03T03:03:03.333Z'),
  };
  updateResult = [{ updatedAt: new Date('2026-03-03T03:03:03.333Z') }];
  lastSetArg = {};
  lastWherePredicate = null;
});

describe('GET /api/tenant/notifications/matrix', () => {
  it('returns the stored grid and the timestamp PATCH needs back', async () => {
    const json = await (await GET(request())).json();
    expect(json.matrix['deal.won']).toEqual({ in_app: true, email: false, telegram: false });
    expect(json.updatedAt).toBe('2026-03-03T03:03:03.333Z');
  });
});

describe('PATCH /api/tenant/notifications/matrix', () => {
  it('scopes the update to the member row, not to id = userId', async () => {
    const res = await PATCH(request({ matrix: {'deal.won': { in_app: true, email: true, telegram: true } } }));
    expect(res.status).toBe(200);

    const sqlText = toSql(lastWherePredicate);
    expect(sqlText).toMatch(/user_id/);
    expect(sqlText).toMatch(/tenant_id/);
    // The old lookup keyed on the surrogate PK with a user id; that column must
    // not appear in the predicate at all.
    expect(sqlText).not.toMatch(/(^|\s|\.)id\s*=\s*/);
    // The user id must be bound as a parameter of the user_id comparison.
    expect(toParams(lastWherePredicate)).toContain('user-1');
  });

  it('writes only the matrix key so the flat prefs survive', async () => {
    await PATCH(request({ matrix: {'deal.won': { in_app: true, email: true, telegram: true } } }));
    const assigned = toSql(lastSetArg.notificationPrefs);
    expect(assigned).toMatch(/jsonb_set/);
    expect(assigned).toMatch(/\{matrix\}/);
    expect(assigned).toMatch(/COALESCE/);
  });

  it('guards on expectedUpdatedAt inside the member predicate instead of 404ing', async () => {
    await PATCH(request({ matrix: {}, expectedUpdatedAt: '2026-03-03T03:03:03.333Z' }));
    expect(toSql(lastWherePredicate)).toMatch(/date_trunc\('millisecond'/);
  });

  it('answers 409 when the guarded update matches no row', async () => {
    updateResult = [];
    const res = await PATCH(request({ matrix: {}, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }));
    expect(res.status).toBe(409);
  });
});
