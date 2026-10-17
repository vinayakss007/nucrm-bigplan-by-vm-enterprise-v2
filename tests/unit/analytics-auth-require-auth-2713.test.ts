/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2713 — two analytics routes answered an unauthenticated caller with 500.
 *
 * `app/api/tenant/analytics/overview/route.ts:35` and
 * `analytics/scheduled-reports/route.ts:23,41` authenticate with
 * `requireTenantCtx()` — the Server-Component helper (`lib/tenant/context.ts:24`).
 * It has no 401 anywhere in its body: it verifies the token through
 * `getCurrentUserForToken` (#2216) and refuses by `redirect('/auth/login')`,
 * which THROWS a Next.js control-flow object. That throw lands in the handler's
 * own `catch`, which reports it as a server fault.
 *
 * Measured at `4bbfb85b`, for a cookie-less, header-less caller:
 *
 * | route | status | body |
 * | --- | --- | --- |
 * | `GET /analytics/overview` | 500 | `Failed to fetch analytics data` |
 * | `GET /analytics/scheduled-reports` | 500 | `Failed to fetch reports` |
 * | `POST /analytics/scheduled-reports` | 500 | `Failed to create report` |
 * | `GET /analytics/churn` (the `requireAuth` sibling) | 401 | `Authentication required` |
 *
 * Three things ride on that: an unauthenticated caller is a 4xx fact, so these
 * 500s pollute the 5xx-rate series `withApiRoute` publishes to `/api/metrics`;
 * the body names which handler ran; and `requireTenantCtx()` reads the session
 * cookie and nothing else (`lib/tenant/context.ts:29-30`), so a Bearer-token or
 * API-key caller — the credential every sibling `/api/tenant/*` route accepts
 * through `requireAuth` (`lib/auth/middleware.ts:238`) — could not sign in here
 * at all.
 *
 * The anonymous cases below are graded by the REAL `requireAuth`: the mock
 * delegates to `vi.importActual`, so a stubbed middleware would not prove the
 * 401. `requireTenantCtx` is mocked to a throwing spy, which makes the red
 * failure the 500 in the table rather than a passing query.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

let realRequireAuth: (req: NextRequest) => Promise<AuthContext | NextResponse>;

/** The page helper must not run inside a route handler at all (#2713). */
const mockRequireTenantCtx = vi.fn(async (): Promise<never> => {
  throw new Error('requireTenantCtx() was called from an API route (#2713)');
});

let selectResults: unknown[][] = [];
let selectCall = 0;
let inserts: Record<string, unknown>[] = [];

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'groupBy', 'orderBy', 'limit', 'offset']) {
    builder[m] = chain;
  }
  builder['where'] = () => builder;
  builder['returning'] = () => builder;
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(() => {
    const rows = selectResults[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(rows);
  }),
  insert: vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      inserts.push(v);
      return { returning: () => makeBuilder([{ id: 'report-1', ...v }]) };
    },
  })),
};

vi.mock('@/lib/tenant/context', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/tenant/context');
  return { ...actual, requireTenantCtx: mockRequireTenantCtx };
});
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  realRequireAuth = actual.requireAuth;
  return { ...actual, requireAuth: vi.fn((req: NextRequest) => realRequireAuth(req)) };
});
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: vi.fn(async () => null) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

const middleware = await import('@/lib/auth/middleware');
const mockRequireAuth = middleware.requireAuth as unknown as ReturnType<typeof vi.fn>;
const overview = await import('@/app/api/tenant/analytics/overview/route');
const scheduled = await import('@/app/api/tenant/analytics/scheduled-reports/route');

function anonReq(method: 'GET' | 'POST', body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/tenant/analytics/x'), {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The six aggregate queries `overview` fires, in `Promise.all` order. */
const OVERVIEW_ROWS = (): unknown[][] => [
  [{ stageId: 's1', stageName: 'Won', count: 3, revenue: '15000.50' }],
  [{ source: 'Referral', count: 5 }],
  [{ status: 'new', count: 6 }],
  [{ total: 10, completed: 6, overdue: 2 }],
  [{ w0: 1, w1: 0, w2: 3, w3: 0, w4: 0, w5: 2, w6: 0, w7: 4 }],
  [{ w0: 0, w1: 1, w2: 0, w3: 0, w4: 5, w5: 0, w6: 0, w7: 2 }],
];

const SCHEDULE_BODY = { name: 'Weekly funnel', type: 'funnel', frequency: 'weekly' };

beforeEach(() => {
  selectResults = [];
  selectCall = 0;
  inserts = [];
  mockRequireTenantCtx.mockClear();
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  // Default: the real helper grades the caller. Authenticated cases override it.
  mockRequireAuth.mockImplementation((req: NextRequest) => realRequireAuth(req));
});

afterEach(() => {
  mockRequireAuth.mockReset();
});

describe('an unauthenticated caller gets 401, not 500 (#2713)', () => {
  const originalDemo = process.env['ALLOW_DEMO_MODE'];
  beforeEach(() => {
    delete process.env['ALLOW_DEMO_MODE'];
  });
  afterEach(() => {
    if (originalDemo === undefined) delete process.env['ALLOW_DEMO_MODE'];
    else process.env['ALLOW_DEMO_MODE'] = originalDemo;
  });

  it.each([
    ['GET /analytics/overview', () => overview.GET(anonReq('GET'))],
    ['GET /analytics/scheduled-reports', () => scheduled.GET(anonReq('GET'))],
    ['POST /analytics/scheduled-reports', () => scheduled.POST(anonReq('POST', SCHEDULE_BODY))],
  ])('%s answers 401 with the auth-layer message', async (which, call) => {
    const res = await call();
    expect(res.status, which).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: 'Authentication required' });
  });

  it('refuses through the auth layer, not the page helper', async () => {
    await overview.GET(anonReq('GET'));
    await scheduled.GET(anonReq('GET'));
    await scheduled.POST(anonReq('POST', SCHEDULE_BODY));
    expect(mockRequireTenantCtx).not.toHaveBeenCalled();
  });

  it('issues no write for the refused POST', async () => {
    await scheduled.POST(anonReq('POST', SCHEDULE_BODY));
    expect(inserts).toHaveLength(0);
  });
});

describe('a signed-in caller still gets their aggregates (#2713)', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue({
      userId: USER, tenantId: TENANT, roleSlug: 'admin',
      permissions: { all: true }, isAdmin: true, isSuperAdmin: false,
    } as unknown as AuthContext);
  });

  it('GET /analytics/overview answers 200 with the F4 aggregate shape', async () => {
    selectResults = OVERVIEW_ROWS();
    const res = await overview.GET(anonReq('GET'));
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const json = JSON.parse(text);
    expect(json.data.deals.byStage).toEqual([{ stageId: 's1', stageName: 'Won', count: 3, revenue: 15000.5 }]);
    expect(json.data.tasks).toEqual({ total: 10, completed: 6, open: 4, overdue: 2 });
    expect(json.data.timeseries.weekly).toHaveLength(8);
  });

  it('GET /analytics/scheduled-reports answers 200', async () => {
    selectResults = [[{ id: 'report-1', tenantId: TENANT, name: 'Weekly funnel' }]];
    const res = await scheduled.GET(anonReq('GET'));
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const json = JSON.parse(text);
    expect(json.data).toHaveLength(1);
  });

  it('POST /analytics/scheduled-reports answers 201 and stamps the tenant it authenticated', async () => {
    const res = await scheduled.POST(anonReq('POST', SCHEDULE_BODY));
    expect(res.status, await res.text()).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.tenantId).toBe(TENANT);
    expect(inserts[0]?.createdBy).toBe(USER);
  });
});
