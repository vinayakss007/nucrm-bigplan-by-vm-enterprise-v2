/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2787 — the three SCIM single-user handlers turn "this URL segment cannot name a user"
 * into a 500, and they do it in a file that no central remedy reaches.
 *
 * `app/api/scim/v2/Users/[id]/route.ts` exports plain `GET`/`PATCH`/`DELETE` — none of them
 * wrapped in `withApiRoute`, so the chokepoint at `lib/api/with-api-route.ts:147`
 * (`clientErrorFromDbCode`, #2131) never runs here — and each handler wraps its own body in a
 * `catch` that answers `generateSCIMError('Internal server error', 500)` after logging. The
 * statement one line before that throw is a uuid comparison on `users.id`
 * (`drizzle/schema/utils.ts:45` — `users` takes its `id` from `pk()`, so the column is
 * `uuid`), so `GET /api/scim/v2/Users/foobar` binds `foobar` into it, Postgres raises
 * `22P02`, and the provisioning client gets a 5xx where RFC 7644 §3.3.2 wants a 404. An IdP
 * that mis-forms a `userId` therefore treats the user as a server-side failure and retries,
 * instead of pruning it.
 *
 * #2781 fixed ten handlers of exactly this shape. Those ten were `withApiRoute` handlers; this
 * file is not one, so it fell out of that scan by construction. `grep -rl "status: 500"
 * --include=route.ts app/api | grep '\[id\]' | xargs grep -L withApiRoute` returns two files:
 * this one, and `app/api/tenant/forms/public/[id]/route.ts`, whose guard at `:15` is the
 * precedent copied here.
 *
 * The mock database answers a predicate the way Postgres does: a string bound against a column
 * whose `getSQLType()` is `uuid` that is not 8-4-4-4-12 hex raises `22P02`. The column type is
 * read off the schema, never a hand-written list, so the mock cannot exempt a query on its own.
 *
 * Three things are pinned per handler, because the guard has to buy the first without costing
 * the other two:
 *   1. a segment that cannot name a row answers **404 in the SCIM envelope**, touching no
 *      database and logging no error — the same body (`'User not found'`) the row-missing
 *      branch already returns, so a malformed URL is not an existence oracle and a SCIM client
 *      still parses the content type;
 *   2. a real uuid still reaches the database (a guard that 404s everything is worse than the
 *      500 it replaces);
 *   3. a genuine fault still logs and still 500s — the catch is not weakened, only made
 *      unreachable for input that was never a candidate.
 *
 * Known residual, pinned rather than papered over, identical to #2781's: `isEntityId()` is
 * deliberately lenient and also admits the structured `ORG-XX-<base62>` format, which a uuid
 * column cannot cast any better than `foobar` can, so that input still reaches the database and
 * still 500s. Nothing in the app mints a structured id today (`generateStructuredId` is called
 * only from `tests/unit/id.test.ts`), and narrowing the shared guard is a different decision
 * than fixing these three handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '66666666-6666-4666-8666-666666666666';
const BAD = 'not-a-uuid';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dialect = new PgDialect({} as never);

const h = vi.hoisted(() => ({
  calls: 0,
  logged: 0,
  fault: null as Error | null,
}));

function enter(): void {
  h.calls += 1;
  if (h.fault) throw h.fault;
}

function pg22P02(value: string): unknown {
  const err = new Error(`invalid input syntax for type uuid: "${value}"`) as Error & { code: string };
  err.code = '22P02';
  return err;
}

function renderPredicate(where: unknown) {
  const q = dialect.sqlToQuery(where as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/** Postgres' own rule, read off the schema rather than a column list. */
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

/** Chainable fake: `select().from().innerJoin().where().limit()` resolves to no rows. */
function fakeSelect(tables: (object | undefined)[]) {
  const builder: Record<string, unknown> = {
    from(table: object) { tables.push(table); return builder; },
    innerJoin(table: object) { tables.push(table); return builder; },
    leftJoin(table: object) { tables.push(table); return builder; },
    where(predicate: unknown) {
      enter();
      for (const table of tables) enforceUuidCast(table, renderPredicate(predicate));
      return builder;
    },
    limit(_n: number) { return builder; },
    offset(_n: number) { return builder; },
    orderBy(_n: unknown) { return builder; },
    async then(resolve: (rows: unknown[]) => void) { resolve([]); },
  };
  return builder;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (projection?: unknown) => {
      void projection;
      return fakeSelect([]);
    },
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    delete: () => ({ where: async () => [] }),
    insert: () => ({ values: async () => [] }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      select: () => fakeSelect([]),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      delete: () => ({ where: async () => [] }),
      insert: () => ({ values: async () => [] }),
    }),
  },
}));

vi.mock('@/lib/errors-server', () => ({
  logError: () => { h.logged += 1; return Promise.resolve(); },
  tenantMeta: () => ({}),
}));

vi.mock('@/lib/scim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scim')>();
  return {
    ...actual,
    // The real envelope is kept (`generateSCIMError` is asserted below); only the credential
    // lookup is replaced, because a SCIM token is an HMAC over a tenant id and has no bearing
    // on which statement a path segment reaches.
    verifySCIMToken: async () => ({ tenantId: TENANT }),
  };
});

vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));

import { GET, PATCH, DELETE } from '@/app/api/scim/v2/Users/[id]/route';

const ROUTE = fileURLToPath(new URL(
  '../../app/api/scim/v2/Users/[id]/route.ts', import.meta.url));

const HANDLERS = [
  { name: 'GET', handler: GET, method: 'GET' },
  { name: 'PATCH', handler: PATCH, method: 'PATCH' },
  { name: 'DELETE', handler: DELETE, method: 'DELETE' },
] as const;

function request(method: string): never {
  return {
    method,
    url: 'http://localhost/api/scim/v2/Users/x',
    headers: new Headers({ authorization: 'Bearer tenant-token' }),
    json: async () => ({}),
  } as never;
}

function call(handler: typeof GET, method: string, id: string) {
  return handler(request(method), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  h.calls = 0;
  h.logged = 0;
  h.fault = null;
});

describe('the SCIM single-user handlers refuse an id that cannot name a user (#2787)', () => {
  it.each(HANDLERS)('$name: a non-uuid segment answers 404 in the SCIM envelope, without a query',
    async ({ handler, method }) => {
      const res = await call(handler, method, BAD);

      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toBe('application/scim+json');
      const body = await res.json() as { detail: string; status: string; schemas: string[] };
      expect(body.detail).toBe('User not found');
      expect(body.status).toBe('404');
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);

      // The whole point: the database was never asked, so nothing was logged either.
      expect(h.calls).toBe(0);
      expect(h.logged).toBe(0);
    });

  it.each(HANDLERS)('$name: a real uuid still reaches the database', async ({ handler, method }) => {
    const res = await call(handler, method, USER);

    expect(h.calls).toBeGreaterThan(0);
    // No row matches in the fake, so the handler answers its own not-found — the guard did
    // not become a wall.
    expect(res.status).toBe(404);
    expect(((await res.json()) as { detail: string }).detail).toBe('User not found');
    expect(h.logged).toBe(0);
  });

  it.each(HANDLERS)('$name: a genuine fault still logs and still 500s', async ({ handler, method }) => {
    h.fault = new Error('connection reset by peer');

    const res = await call(handler, method, USER);

    expect(res.status).toBe(500);
    expect(((await res.json()) as { detail: string }).detail).toBe('Internal server error');
    expect(h.logged).toBe(1);
  });

  it('the unguarded file really did reach Postgres for this input', () => {
    // Reproduced at origin/main by this file's RED run rather than asserted from prose:
    // the guard is the only thing between the segment and the uuid comparison, and the
    // comparison is one statement before the catch that turns it into a 500.
    const src = readFileSync(ROUTE, 'utf8');
    const guards = src.match(/if \(!isEntityId\(id\)\)/g)?.length ?? 0;
    expect(guards).toBe(3);
    expect(src).toMatch(/eq\(users\.id, id\)/);
    expect(src).toMatch(/generateSCIMError\('Internal server error', 500\)/);
    // and no wrapper to map it with, which is why this file is not one of #2781's ten
    expect(src).not.toContain('withApiRoute');
  });

  it('documents the lenient-guard residual rather than silently narrowing isEntityId', async () => {
    // `isEntityId` also admits the structured `ORG-XX-<base62>` format (lib/id.ts:245-262), which a
    // uuid column cannot cast. Same gap #2781 pinned; nothing mints a structured id today.
    const { generateStructuredId, isEntityId } = await import('@/lib/id');
    const structured = generateStructuredId('ACME', 'CT');
    expect(isEntityId(structured)).toBe(true);
    expect(UUID_SHAPE.test(structured)).toBe(false);

    const res = await call(GET, 'GET', structured);
    expect(h.calls).toBeGreaterThan(0);
    expect(res.status).toBe(500);
    expect(h.logged).toBe(1);
  });

  it('keeps the four lookalikes that already route through apiError alone', () => {
    // They answer the uuid cast through `apiError` → `clientErrorFromDbCode`
    // (lib/api-error.ts:48), the same classifier as the wrapper, so adding a guard here is
    // the fix and adding one there would be a second answer to the same problem.
    for (const path of [
      '../../app/api/tenant/api-keys/[id]/route.ts',
      '../../app/api/tenant/approvals/[id]/route.ts',
      '../../app/api/tenant/sso/providers/[id]/route.ts',
      '../../app/api/tenant/quotes/[id]/route.ts',
    ]) {
      const src = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
      expect(src).toMatch(/return apiError\((?:err|error)\)/);
    }
  });
});
