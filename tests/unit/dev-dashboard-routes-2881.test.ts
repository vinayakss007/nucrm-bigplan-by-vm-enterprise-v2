import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2881 — three panels of the development dashboard have been polling endpoints that
 * Next.js will never route.
 *
 * `app/dev/dashboard/page.tsx:77-79` calls `/api/dev/logs`, `/api/dev/queries` and
 * `/api/dev/errors`. Only `app/api/dev/dashboard/route.ts` existed. Two of the three
 * answers were IN that file, as `export async function GET_QUERIES` (:154) and
 * `export async function GET_ERRORS` (:182): a route module dispatches its
 * HTTP-method exports and nothing else, so a suffixed name is an unused function —
 * one that type-checks, lints clean, and whose `403 Development only` guard reads
 * exactly like the live endpoint the page was written against. The third
 * (`/api/dev/logs`) was only ever a line of that file's header comment.
 *
 * So the Logs, Slow Queries and Error Logs panels rendered their empty states on a
 * dev box whose `devLogger` buffers were full, and the header comment went on
 * advertising a URL nobody implemented — which is how the page got written against
 * it in the first place.
 *
 * Two things are tested here. The first is the CLASS, over the whole `app/api` tree:
 * an export named `<METHOD>_<something>` is unreachable, so CI says so at write time
 * instead of leaving it for someone to notice three panels are blank. The second is
 * the three new handlers, run for real against the fake pool and the fake logger,
 * answering the page's own query strings.
 *
 * The class scan found one other pair while it was being written — `POST_LOGOUT` and
 * `POST_SIGNUP` in `app/api/v1/auth/route.ts`, filed as #2884 and deleted here rather
 * than left as the two exceptions that would have made the screen tolerate the next
 * one: neither path has a caller in this repo, `/api/auth/*` answers the same two
 * operations, and #2884 records the other option (route them as the deprecated
 * aliases their comments claim to be) for whoever wants the v1 surface back.
 *
 *   Measured against `main` (86f92769) with only the test files copied over:
 *   `api-url-has-handler-2822` convicts `/api/dev/errors`, `/api/dev/logs` and
 *   `/api/dev/queries` — 5 dangling URLs against 2 allowlisted entries — and this
 *   file and `tests/dashboard/dev-dashboard-page-2881.test.tsx` never collect,
 *   `Cannot find package '@/app/api/dev/logs/route'`. Run the class scan itself
 *   against that tree and it reports `GET_QUERIES`, `GET_ERRORS`, `POST_LOGOUT`,
 *   `POST_SIGNUP`. With the branch's `app/` and `lib/` applied on top, the three
 *   files are 40/40 on the base commit and 40/40 on the branch.
 */

const USER = 'a1111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  /** what `getCurrentUserForToken` answers for the cookie it is handed */
  tokenUser: null as { id: string } | null,
  /** the `users` row the gate reads: `[row]` destructures this */
  userRows: [] as Array<{ id: string; isSuperAdmin: boolean }>,
  /** what `db.execute` answers, in call order, for the dashboard's three counters */
  executeRows: [] as Array<Record<string, unknown>>,
  logs: {
    requests: [] as unknown[],
    queries: [] as unknown[],
    errors: [] as unknown[],
  },
  cleared: 0,
}));

const mockGetCurrentUserForToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/session', () => ({ getCurrentUserForToken: mockGetCurrentUserForToken }));

// The gate's `users` read and the dashboard's three `information_schema` counters,
// both driven from `state`; nothing here needs a real connection.
vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.userRows),
        }),
      }),
    }),
    execute: () => Promise.resolve({ rows: [state.executeRows.shift() ?? {}] }),
  },
}));

vi.mock('@/lib/dev-logger', () => ({
  devLogger: {
    getStats: () => ({
      uptime: '12.34 min',
      totalRequests: 3,
      totalErrors: 1,
      errorRate: '33.33%',
      avgResponseTime: '317ms',
      avgQueryTime: '585ms',
      totalQueries: 3,
      slowQueries: 2,
    }),
    exportLogs: () => ({
      timestamp: new Date('2026-10-19T05:00:00Z').toISOString(),
      stats: {},
      requests: state.logs.requests,
      queries: state.logs.queries,
      errors: state.logs.errors,
    }),
    clear: () => {
      state.cleared++;
    },
  },
}));

// vitest hoists every `vi.mock` above this line, so the route modules under test
// receive the fakes even though the imports read as if they came first.
import { GET as getLogs } from '@/app/api/dev/logs/route';
import { GET as getQueries } from '@/app/api/dev/queries/route';
import { GET as getErrors } from '@/app/api/dev/errors/route';
import { GET as getDashboard, POST as clearDashboard } from '@/app/api/dev/dashboard/route';

/** The page polls these three; each is a `useApiQuery` URL at `page.tsx:77-79`. */
const HANDLERS = [
  ['logs', getLogs, '/api/dev/logs'] as const,
  ['queries', getQueries, '/api/dev/queries'] as const,
  ['errors', getErrors, '/api/dev/errors'] as const,
];

const REQUESTS = [
  { method: 'GET', path: '/api/v1/contacts', status: 200, duration: 12, timestamp: 1 },
  { method: 'POST', path: '/api/v1/deals', status: 201, duration: 40, timestamp: 2 },
  { method: 'GET', path: '/api/v1/leads', status: 500, duration: 900, timestamp: 3 },
];

const QUERIES = [
  { sql: 'select 1', duration: 5, timestamp: 1 },
  { sql: 'select * from contacts', duration: 250, timestamp: 2 },
  { sql: 'select * from deals', duration: 1_500, timestamp: 3 },
];

const ERRORS = [
  { message: 'boom', context: 'login', timestamp: 1_700_000_000_000, stack: 'at Login\nat Route' },
];

function request(url: string, cookie = true): NextRequest {
  const req = new NextRequest(`http://nucrm.test${url}`);
  if (cookie) req.cookies.set('nucrm_session', 'a.jwt.token');
  return req;
}

async function json(res: NextResponse): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  state.tokenUser = { id: USER };
  state.userRows = [{ id: USER, isSuperAdmin: true }];
  state.executeRows = [{ count: '512' }, { count: '9000' }, { count: '4' }];
  state.logs = { requests: REQUESTS, queries: QUERIES, errors: ERRORS };
  state.cleared = 0;
  mockGetCurrentUserForToken.mockImplementation(async () => state.tokenUser);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('the class: a suffixed method name is not a route (#2881)', () => {
  /** Exports Next.js will dispatch, and the config flags a route module may also export. */
  const METHOD_EXPORTS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const UNROUTABLE = new RegExp(
    `^[ \\t]*export[ \\t]+(?:default[ \\t]+)?(?:async[ \\t]+)?(?:function[ \\t]+|const[ \\t]+|let[ \\t]+|var[ \\t]+)?` +
      `((?:${METHOD_EXPORTS.join('|')})_[\\w$]+)`,
    'gm',
  );

  const routeFiles = (dir = 'app/api', out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) routeFiles(p, out);
      else if (/^route\.(ts|tsx|js)$/.test(name)) out.push(p);
    }
    return out;
  };

  const unroutableIn = (source: string): string[] =>
    [...source.matchAll(UNROUTABLE)].map((m) => m[1] as string);

  it('convicts an export whose name starts with a method but is not one (control)', () => {
    expect(unroutableIn('export async function GET_QUERIES(request: NextRequest) {}')).toEqual(['GET_QUERIES']);
    expect(unroutableIn('export const POST_LOGOUT = async () => {}')).toEqual(['POST_LOGOUT']);
    // and does not convict the live forms of the same letters
    expect(unroutableIn('export async function GET(request: NextRequest) {}\nexport const POST = async () => {}')).toEqual([]);
    // nor a constant that merely shares the prefix style
    expect(unroutableIn('export const REPORT_LIMIT_MAX = 500;')).toEqual([]);
  });

  it('the three dev routes the page polls are dispatchable exports of real route modules', () => {
    for (const [name, handler, url] of HANDLERS) {
      expect(handler, `${url} has no GET`).toBeTypeOf('function');
      expect(readFileSync(join('app', 'api', 'dev', name, 'route.ts'), 'utf8')).toMatch(
        /^export async function GET\(/m,
      );
    }
  });

  it('nothing in the tree exports a name Next will never route', () => {
    // No allowlist: #2884's two (`POST_LOGOUT`, `POST_SIGNUP` in
    // app/api/v1/auth/route.ts) were unreachable in the same way as #2881's pair,
    // so they were deleted rather than routed — no caller in the repo used either
    // path, `/api/auth/logout` and `/api/auth/signup` are the live endpoints, and
    // the one that was not a logout was an auto-login that marked the new account
    // `emailVerified: true`.
    const found: Array<{ name: string; file: string }> = [];
    for (const file of routeFiles()) {
      for (const name of unroutableIn(readFileSync(file, 'utf8'))) found.push({ name, file });
    }

    expect(
      found,
      `dead exports, named like handlers: ${found.map((f) => `${f.name} (${f.file})`).join(', ')}`,
    ).toEqual([]);
  });

  it('convicts a route module that adds one back (control)', () => {
    // the point of the screen is that the next `GET_SOMETHING` fails CI at write
    // time, so prove the scan is not vacuous over the tree it now finds clean
    const planted = `
export async function GET(request: NextRequest) { return new Response(null); }
export async function GET_EXPORTS(request: NextRequest) { return new Response(null); }
export const POST_BATCH = async () => new Response(null);
export const REPORT_LIMIT_MAX = 500;
`;
    expect(unroutableIn(planted)).toEqual(['GET_EXPORTS', 'POST_BATCH']);
    expect(routeFiles().length, 'the walk found no route files — the scan is vacuous').toBeGreaterThan(400);
  });

  it('the dashboard module no longer claims endpoints it does not answer', () => {
    const src = readFileSync('app/api/dev/dashboard/route.ts', 'utf8');
    expect(
      [...src.matchAll(/^export\s+(?:async\s+)?function\s+([\w$]+)/gm)].map((m) => m[1]).sort(),
      'a route module dispatches GET/POST only — anything else here is unreachable',
    ).toEqual(['GET', 'POST']);
    // A header comment naming URLs is what the page got written against (#2881), so
    // every /api/dev/... path this file carries has to be a route module in the tree —
    // prose about the old list included.
    for (const url of src.match(/\/api\/dev\/[\w-]+/g) ?? []) {
      expect(
        existsSync(join('app', 'api', 'dev', url.slice('/api/dev/'.length), 'route.ts')),
        `${url} is named here and answered nowhere`,
      ).toBe(true);
    }
    // and the three this module does not route are named as the modules that do
    for (const name of ['logs', 'queries', 'errors']) {
      expect(src, `the header points at /api/dev/${name} without naming its handler`).toContain(
        `app/api/dev/${name}/route.ts`,
      );
    }
  });
});

describe('the gate (#2881)', () => {
  for (const [name, handler, url] of HANDLERS) {
    it(`${name}: refuses outside development`, async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const res = (await handler(request(url))) as NextResponse;
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: 'Development only' });
      // the refusal comes before the session is read: nothing is looked up to say no
      expect(mockGetCurrentUserForToken).not.toHaveBeenCalled();
    });

    it(`${name}: refuses a caller who is not a super admin`, async () => {
      state.userRows = [{ id: USER, isSuperAdmin: false }];
      const res = (await handler(request(`${url}?limit=1`))) as NextResponse;
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: 'Super admin access required' });

      state.userRows = [];
      const gone = (await handler(request(`${url}?limit=1`))) as NextResponse;
      expect(gone.status).toBe(403);

      // #2216: a revoked or logged-out token has no live session row
      state.tokenUser = null;
      state.userRows = [{ id: USER, isSuperAdmin: true }];
      const revoked = (await handler(request(`${url}?limit=1`))) as NextResponse;
      expect(revoked.status).toBe(403);
    });

    it(`${name}: refuses an unauthenticated request`, async () => {
      const res = (await handler(request(url, false))) as NextResponse;
      expect(res.status).toBe(403);
      expect(mockGetCurrentUserForToken).not.toHaveBeenCalled();
    });
  }

  it('POST /api/dev/dashboard is behind the same two halves', async () => {
    const ok = (await clearDashboard(request('/api/dev/dashboard'))) as NextResponse;
    expect(ok.status).toBe(200);
    expect(state.cleared).toBe(1);

    vi.stubEnv('NODE_ENV', 'production');
    const blocked = (await clearDashboard(request('/api/dev/dashboard'))) as NextResponse;
    expect(blocked.status).toBe(403);
    expect(state.cleared, 'a refused clear must not have cleared anything').toBe(1);
  });
});

describe('GET /api/dev/logs answers the page that has been polling it (#2881)', () => {
  it('returns the request buffer under the key the page reads', async () => {
    const res = (await getLogs(request('/api/dev/logs?limit=50'))) as NextResponse;
    expect(res.status).toBe(200);
    const body = await json(res);
    // `logsQuery.data?.requests ?? []` — page.tsx:82
    expect(body.requests).toEqual(REQUESTS);
    expect(body.total).toBe(3);
  });

  it('gives every row the fields the Requests tab renders', async () => {
    const body = await json((await getLogs(request('/api/dev/logs'))) as NextResponse);
    const rows = body.requests as Array<Record<string, unknown>>;
    // page.tsx:329-342 reads req.method / path / status / duration / timestamp
    expect(rows[0]).toMatchObject({
      method: 'GET',
      path: '/api/v1/contacts',
      status: 200,
      duration: 12,
      timestamp: 1,
    });
    expect(rows).toHaveLength(REQUESTS.length);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['duration', 'method', 'path', 'status', 'timestamp']);
    }
  });

  it('keeps the most recent entries when the buffer is longer than the limit', async () => {
    const body = await json((await getLogs(request('/api/dev/logs?limit=2'))) as NextResponse);
    expect(body.requests).toEqual(REQUESTS.slice(-2));
    expect(body.total, 'total is the whole buffer, not the page').toBe(3);
  });

  it('clamps a limit a hand-typed dev URL cannot make meaningless', async () => {
    // `parseInt('abc')` is NaN and `slice(-NaN)` is `slice(0)` — the whole buffer,
    // every path and status the process recorded, whatever the caller asked for
    const many = Array.from({ length: 1_200 }, (_, i) => ({
      method: 'GET',
      path: `/api/v1/contacts/${i}`,
      status: 200,
      duration: 1,
      timestamp: i,
    }));
    state.logs.requests = many;

    const junk = await json((await getLogs(request('/api/dev/logs?limit=abc'))) as NextResponse);
    expect(junk.requests).toHaveLength(100);

    const huge = await json((await getLogs(request('/api/dev/logs?limit=999999'))) as NextResponse);
    expect(huge.requests).toHaveLength(1_000);

    const zero = await json((await getLogs(request('/api/dev/logs?limit=0'))) as NextResponse);
    expect(zero.requests).toHaveLength(1);
  });
});

describe('GET /api/dev/queries answers the Slow Queries panel (#2881)', () => {
  it('serves the exact query string the page sends', async () => {
    const res = (await getQueries(request('/api/dev/queries?limit=50&slow=true'))) as NextResponse;
    expect(res.status).toBe(200);
    const body = await json(res);
    // `queriesQuery.data?.queries ?? []` — page.tsx:83; `slow=true` is what the
    // "Slow Database Queries" tab asks for, and the default threshold is the
    // 100ms the Overview card prints
    const rows = body.queries as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sql: 'select * from contacts', duration: 250 });
    expect(rows[1]).toMatchObject({ sql: 'select * from deals', duration: 1_500 });
    expect(body.total).toBe(2);
    expect(body.slow).toBe(2);
  });

  it('returns everything when the caller did not ask for slow only', async () => {
    const body = await json((await getQueries(request('/api/dev/queries'))) as NextResponse);
    expect(body.queries).toEqual(QUERIES);
    expect(body.total).toBe(3);
    expect(body.slow).toBe(2);
  });

  it('honours an explicit threshold', async () => {
    const body = await json(
      (await getQueries(request('/api/dev/queries?slow=true&threshold=1000'))) as NextResponse,
    );
    expect(body.queries).toMatchObject([{ sql: 'select * from deals' }]);
  });

  it('gives every row the fields the Queries tab renders', async () => {
    const body = await json((await getQueries(request('/api/dev/queries'))) as NextResponse);
    for (const row of body.queries as Array<Record<string, unknown>>) {
      // page.tsx:360-367 reads q.duration and q.sql
      expect(row).toHaveProperty('sql');
      expect(row).toHaveProperty('duration');
      expect(row).toHaveProperty('timestamp');
    }
  });

  it('clamps the limit the same way', async () => {
    const body = await json((await getQueries(request('/api/dev/queries?limit=0'))) as NextResponse);
    expect(body.queries).toHaveLength(1);
  });
});

describe('GET /api/dev/errors answers the Error Logs panel (#2881)', () => {
  it('serves the page’s own query string', async () => {
    const res = (await getErrors(request('/api/dev/errors?limit=20'))) as NextResponse;
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.errors).toMatchObject([{ message: 'boom', context: 'login' }]);
    expect(body.total).toBe(1);
  });

  it('hands the page an ISO timestamp and the stack it renders', async () => {
    const body = await json((await getErrors(request('/api/dev/errors'))) as NextResponse);
    const [error] = body.errors as Array<Record<string, unknown>>;
    // `ErrorLog.timestamp: string`, and the tab prints `new Date(err.timestamp)`
    expect(error.timestamp).toBe('2023-11-14T22:13:20.000Z');
    expect(() => new Date(error.timestamp as string).toISOString()).not.toThrow();
    // page.tsx:394 renders `err.stack` — the handler this replaced dropped the field,
    // so not one error would have shown a trace even after the 404 stopped
    expect(error.stack).toBe('at Login\nat Route');
  });
});

describe('GET /api/dev/dashboard answers the fields the page dereferences (#2881)', () => {
  it('carries uptime, nodeVersion and memory, which the Overview tab reads bare', async () => {
    const res = (await getDashboard(request('/api/dev/dashboard'))) as NextResponse;
    expect(res.status).toBe(200);
    const body = await json(res);
    // page.tsx:159 `formatUptime(data.uptime)` and :253-255 `data.memory.rss` are
    // property reads, not optional ones: with `memory` absent the Overview tab threw
    // on the first render and the dashboard never drew at all.
    expect(typeof body.uptime).toBe('number');
    expect(body.nodeVersion).toBe(process.version);
    expect(body.memory).toMatchObject({ rss: expect.any(Number), heapUsed: expect.any(Number) });
    expect(Object.keys(body.memory as object).sort()).toEqual([
      'external',
      'heapTotal',
      'heapUsed',
      'rss',
    ]);
  });

  it('keeps the stats, dbStats and environment the page already read', async () => {
    const body = await json((await getDashboard(request('/api/dev/dashboard'))) as NextResponse);
    expect(body.dbStats).toEqual({ tables: 512, totalRows: 9000, activeConnections: 4 });
    expect((body.environment as Record<string, string>).nodeEnv).toBe('development');
    expect(body.environment).toHaveProperty('databaseUrl');
    expect(body).toHaveProperty('stats');
  });

  it('still refuses a caller who is not a super admin, in any environment', async () => {
    state.userRows = [{ id: USER, isSuperAdmin: false }];
    const res = (await getDashboard(request('/api/dev/dashboard'))) as NextResponse;
    expect(res.status).toBe(403);

    // #1138: the endpoint stays open to production super admins; the configuration
    // surface inside it is what is dev-only
    vi.stubEnv('NODE_ENV', 'production');
    state.userRows = [{ id: USER, isSuperAdmin: true }];
    const prod = (await getDashboard(request('/api/dev/dashboard'))) as NextResponse;
    expect(prod.status).toBe(200);
    const prodBody = await json(prod);
    expect(prodBody.environment).toEqual({
      nodeEnv: 'production',
      config: 'not exposed outside development',
    });
  });
});
