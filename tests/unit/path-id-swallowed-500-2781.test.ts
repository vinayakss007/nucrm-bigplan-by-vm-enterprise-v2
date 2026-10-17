/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2781 — ten `[id]` handlers read the URL segment, compare it against a **uuid**
 * column, and wrap the whole thing in a `catch` that answers a literal 500. That
 * catch fires one statement before the throw it is guarding, so the error never
 * reaches `withApiRoute`, whose `clientErrorFromDbCode()`
 * (`lib/api/db-client-error.ts:98-103`) would have answered 404 for exactly this
 * SQLSTATE (`22P02` on a uuid: "not a uuid cannot name an entity"). #2131 minted
 * `isEntityId()` for the class; these ten were invisible to its fix because they
 * do not throw out — `lib/api/with-api-route.ts:52` propagates thrown errors
 * unchanged, and a handler that catches first leaves nothing to propagate.
 *
 * The mock database answers a predicate the way Postgres does: a string bound
 * against a column whose `getSQLType()` is `uuid` and that is not 8-4-4-4-12 hex
 * raises `22P02` (`drizzle/schema/utils.ts:45` — all four tables here key on
 * `utils.pk()`). So the "before" column of this file is not a test that fails
 * because a call was missing; it reproduces the 500 the route actually returned.
 *
 * Three things are pinned per handler, because the guard has to buy the first
 * without costing the other two:
 *   1. a segment that cannot name a row answers 404 with the handler's own
 *      not-found body, touching **no** database and logging **no** error;
 *   2. a real uuid still reaches the database (a guard that 404s everything is
 *      worse than the 500 it replaces);
 *   3. a genuine fault still answers 500 — the catch is not weakened, only made
 *      unreachable for input that was never a candidate.
 *
 * The status is 404 even on the POST and DELETE handlers, where the central
 * mapper's POST branch would have said 400 "Invalid identifier in request body":
 * the malformed value is in the path, not the body, and the house precedent for a
 * path id is 404 with the row-missing body (`app/api/tenant/forms/[id]/route.ts:24,63,104`
 * and `app/api/tenant/contacts/[id]/notes/route.ts:29`, where POST also 404s a path
 * id that cannot name a contact — #2724). Reusing the row-missing body is also what
 * keeps a malformed URL from becoming an existence oracle.
 *
 * Known residual, pinned below rather than papered over: `isEntityId()` is
 * deliberately lenient and also admits the structured `ORG-XX-<base62>` id format,
 * which a uuid column cannot cast any better than "not-a-uuid" can, so that input
 * still reaches the database and still 500s. Nothing in the app mints a structured
 * id today — `generateStructuredId` is called only from `tests/unit/id.test.ts` —
 * and the same leniency is what every other guarded `[id]` route already has, so
 * this file records the gap instead of silently narrowing the guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableColumns, getTableName } from 'drizzle-orm';
import * as schema from '@/drizzle/schema';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const GOOD = '33333333-3333-4333-8333-333333333333';
const BAD = 'not-a-uuid';

// What the Postgres uuid cast actually accepts: the app's own seed ids
// (50000000-0000-0000-0000-000000000001) are legal, version nibble be damned
// (#2286), and lib/id.ts's isUuid agrees. Anything this refuses is what the
// cast refuses — that equivalence is the whole point of the mock below.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dialect = new PgDialect({} as never);

const h = vi.hoisted(() => ({
  calls: 0,
  logged: 0,
  fault: null as unknown,
  body: {} as Record<string, unknown>,
  superadmin: true,
}));

/** The driver error a uuid column raises for a value it cannot cast. */
function pg22P02(value: string): unknown {
  const err = new Error(`invalid input syntax for type uuid: "${value}"`) as Error & { code: string };
  err.code = '22P02';
  return err;
}

vi.mock('@/lib/errors-server', () => ({
  logError: () => { h.logged += 1; return Promise.resolve(); },
  tenantMeta: () => ({}),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(), can: () => true };
});
vi.mock('@/drizzle/db', () => ({ db: makeDb() }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => h.body };
});
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: async () => undefined }));
vi.mock('@/lib/db/rls', () => ({
  withTenantContext: async (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@/lib/segments/evaluate', () => ({
  evaluateSegment: async () => ({ matchedIds: [] }),
  isSegmentEntityType: () => true,
  SegmentFilterError: class extends Error {},
}));

function renderPredicate(predicate: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

function tableNamed(name: string): object | undefined {
  for (const candidate of Object.values(schema)) {
    try {
      if (getTableName(candidate as never) === name) return candidate as object;
    } catch {
      // Not a drizzle table — a helper, enum or re-exported column.
    }
  }
  return undefined;
}

/** Every entry point into the "database" passes through here. */
function enter(): void {
  h.calls += 1;
  if (h.fault) throw h.fault;
}

/**
 * Raise on the first param bound against a uuid column that Postgres could not
 * cast. The column type is read off the schema (`getSQLType()`), never from a
 * hand-written column-name list, so the mock cannot decide on its own that some
 * new query is exempt.
 */
function enforceUuidCast(table: object | undefined, q: { sql: string; params: unknown[] }): void {
  if (!table) return;
  const columns = getTableColumns(table as never) as Record<string, { name: string; getSQLType(): string }>;
  const byName = new Map<string, { getSQLType(): string }>();
  for (const col of Object.values(columns)) byName.set(col.name, col);
  for (const m of q.sql.matchAll(/"(\w+)" = \$(\d+)/g)) {
    const col = byName.get(m[1]);
    const value = q.params[Number(m[2]) - 1];
    if (col?.getSQLType() === 'uuid' && typeof value === 'string' && !UUID_SHAPE.test(value)) {
      throw pg22P02(value);
    }
  }
}

interface FakeBuilder extends PromiseLike<unknown[]> {
  from(t: object): FakeBuilder;
  where(p: unknown): FakeBuilder;
  [key: string]: unknown;
}

/**
 * A query builder that answers by its own bound parameters and nothing else:
 * every drizzle method (`leftJoin`, `groupBy`, `as`, `set`, `values`, `limit`,
 * …) chains, and awaiting it runs the cast check the way the database would.
 */
function makeSelect(tableHint?: object): FakeBuilder {
  let table: object | undefined = tableHint;
  let predicate: unknown;

  const resolve = () => {
    enter();
    // A join adds tables the cast rule still has to see, but the comparison
    // that carries the URL segment always names the primary table.
    if (predicate !== undefined) enforceUuidCast(table, renderPredicate(predicate));
    return [];
  };

  const builder: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onDone?: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
          let settled: Promise<unknown>;
          try {
            settled = Promise.resolve(resolve());
          } catch (err) {
            settled = Promise.reject(err);
          }
          return settled.then(onDone, onErr);
        };
      }
      if (prop === 'from') return (t: object) => { table = t; return builder; };
      if (prop === 'where') return (p: unknown) => { predicate = p; return builder; };
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => '[mock query builder]';
      return () => builder;
    },
  });

  return builder as FakeBuilder;
}

function makeDb() {
  const query = new Proxy({}, {
    get: (_t, name: string) => ({
      findFirst: async (opts: { where?: unknown } = {}) => {
        enter();
        if (opts.where !== undefined) enforceUuidCast(tableNamed(name), renderPredicate(opts.where));
        return undefined;
      },
      findMany: async (opts: { where?: unknown } = {}) => {
        enter();
        if (opts.where !== undefined) enforceUuidCast(tableNamed(name), renderPredicate(opts.where));
        return [];
      },
    }),
  });

  return {
    select: () => makeSelect(),
    update: (t: object) => makeSelect(t),
    delete: (t: object) => makeSelect(t),
    insert: (t: object) => makeSelect(t),
    execute: async () => { enter(); return { rows: [] }; },
    query,
  };
}

const { requireAuth } = await import('@/lib/auth/middleware');
const mockedRequireAuth = vi.mocked(requireAuth);

const tenantsRoute = await import('@/app/api/superadmin/tenants/[id]/route');
const limitsRoute = await import('@/app/api/superadmin/tenants/[id]/limits/route');
const usersRoute = await import('@/app/api/superadmin/users/[id]/route');
const analyticsRoute = await import('@/app/api/tenant/forms/[id]/analytics/route');
const segmentsRoute = await import('@/app/api/tenant/segments/[id]/route');
const enrollRoute = await import('@/app/api/tenant/segments/[id]/enroll/route');
const membersRoute = await import('@/app/api/tenant/segments/[id]/members/route');

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

interface Subject {
  label: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  handler: Handler;
  /** The body the row-missing branch answers, which the guard must reuse. */
  notFound: string;
  /** What readJsonBody resolves to; handlers that read no body ignore it. */
  body?: Record<string, unknown>;
}

const SUBJECTS: Subject[] = [
  {
    label: 'GET /api/superadmin/tenants/[id]',
    method: 'GET', url: '/api/superadmin/tenants', handler: tenantsRoute.GET, notFound: 'Tenant not found',
  },
  {
    label: 'GET /api/superadmin/tenants/[id]/limits',
    method: 'GET', url: '/api/superadmin/tenants/limits', handler: limitsRoute.GET, notFound: 'Not found',
  },
  {
    label: 'PATCH /api/superadmin/tenants/[id]/limits',
    method: 'PATCH', url: '/api/superadmin/tenants/limits', handler: limitsRoute.PATCH, notFound: 'Not found', body: {},
  },
  {
    label: 'GET /api/superadmin/users/[id]',
    method: 'GET', url: '/api/superadmin/users', handler: usersRoute.GET, notFound: 'User not found',
  },
  {
    label: 'GET /api/tenant/forms/[id]/analytics',
    method: 'GET', url: '/api/tenant/forms/analytics', handler: analyticsRoute.GET, notFound: 'Not found',
  },
  {
    label: 'POST /api/tenant/forms/[id]/analytics',
    method: 'POST', url: '/api/tenant/forms/analytics', handler: analyticsRoute.POST, notFound: 'Not found', body: { type: 'view' },
  },
  {
    label: 'DELETE /api/tenant/segments/[id]',
    method: 'DELETE', url: '/api/tenant/segments', handler: segmentsRoute.DELETE, notFound: 'Segment not found',
  },
  {
    label: 'POST /api/tenant/segments/[id]/enroll',
    method: 'POST', url: '/api/tenant/segments/enroll', handler: enrollRoute.POST, notFound: 'Segment not found',
    body: { sequence_id: GOOD },
  },
  {
    label: 'GET /api/tenant/segments/[id]/members',
    method: 'GET', url: '/api/tenant/segments/members', handler: membersRoute.GET, notFound: 'Segment not found',
  },
  {
    label: 'POST /api/tenant/segments/[id]/members',
    method: 'POST', url: '/api/tenant/segments/members', handler: membersRoute.POST, notFound: 'Segment not found', body: {},
  },
];

function requestFor(subject: Subject, id: string): NextRequest {
  const req = new NextRequest(`http://localhost${subject.url}/${id}`, { method: subject.method });
  mockedRequireAuth.mockResolvedValue({
    tenantId: TENANT,
    userId: USER,
    email: 'admin@example.test',
    role: 'superadmin',
    isSuperAdmin: h.superadmin,
    user: { email: 'admin@example.test' },
  } as unknown as Awaited<ReturnType<typeof requireAuth>>);
  h.body = subject.body ?? {};
  return req;
}

async function call(subject: Subject, id: string): Promise<Response> {
  return subject.handler(requestFor(subject, id), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  h.calls = 0;
  h.logged = 0;
  h.fault = null;
  h.superadmin = true;
});

describe('#2781 — a path segment that cannot name a row is answered by the handler, not by the cast', () => {
  describe.each(SUBJECTS)('$label', (subject) => {
    it('404s "' + BAD + '" with the row-missing body, without touching the database', async () => {
      const res = await call(subject, BAD);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: subject.notFound });
      expect(h.calls).toBe(0);
      // A refusal on URL shape is not a server fault: no Sentry page, no error log.
      expect(h.logged).toBe(0);
    });

    it('still sends a real uuid to the database', async () => {
      const res = await call(subject, GOOD);
      expect(h.calls).toBeGreaterThan(0);
      // Nothing exists in the mock, so the handler answers its own not-found —
      // the guard must not be what produces this 404.
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: subject.notFound });
      expect(h.logged).toBe(0);
    });

    it('keeps answering 500 for a fault that is actually the server’s', async () => {
      h.fault = new Error('connection terminated unexpectedly');
      const res = await call(subject, GOOD);
      expect(res.status).toBe(500);
    });
  });

  it('answers 403 before the guard when the caller is no superadmin at all', async () => {
    h.superadmin = false;
    const res = await call(SUBJECTS[0], BAD);
    expect(res.status).toBe(403);
    expect(h.calls).toBe(0);
  });

  it('leaves the structured-id format to the cast it cannot pass, as every other guarded [id] route does', async () => {
    const { generateStructuredId, isEntityId } = await import('@/lib/id');
    const structured = generateStructuredId('ACME', 'CT');

    expect(isEntityId(structured)).toBe(true);
    expect(UUID_SHAPE.test(structured)).toBe(false);

    // So the guard admits it, the query runs, and Postgres still refuses the cast —
    // which is #2131's residual here, not this file's regression to hide.
    const res = await call(SUBJECTS[0], structured);
    expect(h.calls).toBeGreaterThan(0);
    expect(res.status).toBe(500);
  });

  it('would have been answered 404 by the central mapper had the handler not caught first', async () => {
    const { clientErrorFromDbCode } = await import('@/lib/api/db-client-error');
    expect(clientErrorFromDbCode(pg22P02(BAD), 'GET')).toEqual({ status: 404, message: 'Not found' });
    expect(clientErrorFromDbCode(pg22P02(BAD), 'POST')?.status).toBe(400);
  });
});
