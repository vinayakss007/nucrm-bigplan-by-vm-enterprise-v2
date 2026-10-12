import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * /api/tenant/notification-prefs shares the `tenant_members.notification_prefs`
 * jsonb column with /api/tenant/notifications/matrix, which keeps its per-event
 * channel grid under the `matrix` key of the SAME column. The prefs PATCH used to
 * assign its own object outright, so saving one checkbox erased the grid.
 *
 * It also never returned the row's `updatedAt`, which is exactly the value PATCH
 * wants back as `expectedUpdatedAt` — so the optimistic-concurrency guard the
 * route advertises could never be driven by a client.
 */

const mockCtx = { tenantId: 'tenant-1', userId: 'user-1' };
const mockRequireAuth = vi.fn();

let findFirstResult: unknown = null;
let updateResult: unknown[] = [];
let lastSetArg: Record<string, unknown> = {};
let lastWherePredicate: unknown = null;

const dialect = new PgDialect();
const toSql = (fragment: unknown) => dialect.sqlToQuery(fragment as never).sql;

function makeUpdateBuilder() {
  const b: Record<string, unknown> = {};
  b.set = (arg: Record<string, unknown>) => { lastSetArg = arg; return b; };
  b.where = (p: unknown) => { lastWherePredicate = p; return b; };
  b.returning = () => Promise.resolve(updateResult);
  return b;
}

const mockDb = {
  query: {
    tenantMembers: { findFirst: vi.fn(async () => findFirstResult) },
  },
  update: vi.fn(() => makeUpdateBuilder()),
};

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));

const { GET, PATCH } = await import('@/app/api/tenant/notification-prefs/route');

type Req = import('next/server').NextRequest;
function request(method: 'GET' | 'PATCH', body?: unknown): Req {
  return new Request('http://localhost/api/tenant/notification-prefs', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as Req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(mockCtx);
  findFirstResult = {
    notificationPrefs: { email_notifications: true },
    updatedAt: new Date('2026-01-02T03:04:05.678Z'),
  };
  updateResult = [{
    notificationPrefs: { email_notifications: false },
    updatedAt: new Date('2026-01-02T03:04:05.678Z'),
  }];
  lastSetArg = {};
  lastWherePredicate = null;
});

describe('GET /api/tenant/notification-prefs', () => {
  it('returns updatedAt so a client can round-trip expectedUpdatedAt', async () => {
    const json = await (await GET(request('GET'))).json();
    expect(json.updatedAt).toBe('2026-01-02T03:04:05.678Z');
    expect(json.data).toEqual({ email_notifications: true });
  });

  it('reports a null timestamp rather than an absent key when the row is missing', async () => {
    findFirstResult = undefined;
    const json = await (await GET(request('GET'))).json();
    expect(json).toEqual({ data: {}, updatedAt: null });
  });
});

describe('PATCH /api/tenant/notification-prefs', () => {
  it('merges into the stored jsonb instead of replacing it', async () => {
    const res = await PATCH(request('PATCH', { email_notifications: false }));
    expect(res.status).toBe(200);

    const assigned = toSql(lastSetArg.notificationPrefs);
    expect(assigned).toMatch(/COALESCE/);
    expect(assigned).toMatch(/\|\|/);
    expect(lastSetArg.notificationPrefs).toBeDefined();
  });

  it('echoes the merged prefs plus the new timestamp', async () => {
    updateResult = [{
      notificationPrefs: { email_notifications: false, matrix: { deal_won: { email: true } } },
      updatedAt: new Date('2026-05-05T00:00:00.000Z'),
    }];
    const json = await (await PATCH(request('PATCH', { email_notifications: false }))).json();
    expect(json.ok).toBe(true);
    // The matrix route's data has to survive a prefs save, visibly.
    expect(json.data.matrix).toEqual({ deal_won: { email: true } });
    expect(json.updatedAt).toBe('2026-05-05T00:00:00.000Z');
  });

  it('adds the concurrency predicate only when the client sends expectedUpdatedAt', async () => {
    await PATCH(request('PATCH', { email_notifications: false }));
    expect(toSql(lastWherePredicate)).not.toMatch(/date_trunc/);

    await PATCH(request('PATCH', { email_notifications: false, expectedUpdatedAt: '2026-01-02T03:04:05.678Z' }));
    expect(toSql(lastWherePredicate)).toMatch(/date_trunc\('millisecond'/);
  });

  it('answers 409 when the guarded update matches no row', async () => {
    updateResult = [];
    const res = await PATCH(request('PATCH', {
      email_notifications: false, expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    }));
    expect(res.status).toBe(409);
  });
});
