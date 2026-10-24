/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3194 — three writes on tenant-owned tables named only the row id and rested
 * tenancy entirely on the SELECT that ran a few lines earlier:
 *
 *   - `PATCH /api/tenant/sso/providers/[id]`  vetoes `existing.tenantId !== ctx.tenantId`
 *     in JS, then writes `UPDATE … WHERE id = $1`. Nothing in the SQL says whose
 *     row it may touch.
 *   - same file, `DELETE`  soft-deletes `WHERE id = $1` and never `.returning()`s —
 *     a row that vanished between the read and the write still answered
 *     `{ ok: true }`, and the caller was told the delete landed.
 *   - `DELETE /api/tenant/files`  hard-deletes `WHERE id = $1` inside a
 *     `db.transaction`, decrements the tenant counter, and returns `{ ok: true }`
 *     without ever looking at what the delete matched. The S3 object is already
 *     gone by that point, so if the DB row was removed underneath us by a
 *     concurrent caller, the response lies about the DB/counter half.
 *
 * The doctrine — established #2383 → #2402 → #3159 → #3177 → #3184 → #3189 — is
 * that whatever a preceding unlocked read was used to *vet* must also appear in
 * the WHERE, and the write must claim the row it claims to have touched:
 * Postgres re-evaluates the UPDATE/DELETE's WHERE under the row lock, so adding
 * the tenant predicate turns a stale or wrong-tenant write into zero rows; and
 * `.returning({ id })` with an empty result is what lets the handler answer
 * honestly.
 *
 * This suite is the PgDialect harness from `offer-transition-guarded-write-3159`
 * / `contract-status-transition-race-3189`, not a mock call count: each write's
 * WHERE is rendered to SQL and asserted to carry `"…"."tenant_id"`, and the
 * mutation is proved to bite — `eq(table.id, …)` alone is rendered as a control
 * and asserted NOT to match, so a reviewer deleting the tenant predicate would
 * see the guard fail rather than watch a mock-call count stay green.
 *
 * On the RLS half — the second half of the issue title — the reads here are NOT
 * on the contextless pool. All three handlers are wrapped in `withApiRoute`,
 * which pins one `PoolClient` for the request (`lib/api/with-api-route.ts`,
 * #1615), `requireAuth()` runs its own `withPinnedConnection` on the SAME
 * client (`lib/db/request-connection.ts:205` — a nested pin reuses the
 * existing one, it does not acquire a second), and it calls
 * `setTenantContext(ctx.tenantId, ctx.userId)` on that client before the
 * handler's own reads begin. The `db.query.fileAttachments.findFirst` in files
 * DELETE and the `db.select(...)` in both SSO handlers run against the pinned
 * connection with `app.current_tenant` set, so they resolve the tenant's rows
 * and the JS `existing.tenantId !== ctx.tenantId` check has real data behind
 * it — the issue's own "Is it exploitable today? No" confirms this. The
 * counter decrement inside files DELETE runs under `db.transaction`, which
 * PP-027 wraps with the request's carried tenant identity so the same GUC is
 * visible inside the transaction too. That is why the shape of this fix is
 * predicates + `.returning()` read-backs (the "Fix shape" section of the
 * issue) rather than the `withTenantContext(…)`-wrap the #3182/#3163 template
 * applies: there is no contextless read here to wrap, and inventing a context
 * would change behaviour the issue explicitly says must stay the same. What
 * would change the fix's shape is any refactor that lifts the read out of the
 * pinned scope (or moves the write to a different code path with no
 * `withApiRoute` wrapper) — and that is exactly the failure mode the predicate
 * defends against, per the issue's own framing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, eq } from 'drizzle-orm';
import { ssoProviders, fileAttachments } from '@/drizzle/schema';
import type { AuthContext } from '@/lib/auth/middleware';

// RFC 2606 `.test` fixtures and TEST-NET-style UUIDs only — this repo is public.
const TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROVIDER = '33333333-3333-4333-8333-333333333333';
const ATTACHMENT = '44444444-4444-4444-8444-444444444444';

const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** Rows every pre-write `db.select(...).from(...).where(...).limit(1)` resolves to. */
  readRows: [] as unknown[],
  /** The row `db.query.fileAttachments.findFirst(...)` returns. */
  fileRow: null as Record<string, unknown> | null,
  /** `.returning()` fixtures per `db.update` statement, in call order. */
  updateReturns: [] as unknown[][],
  /** WHEREs of every `db.update` that was consumed, in call order. */
  dbUpdates: [] as Captured[],
  /** `.returning()` fixtures per `tx.delete` statement, in call order. */
  txDeleteReturns: [] as unknown[][],
  /** WHEREs of every `tx.delete` that was consumed, in call order. */
  txDeletes: [] as Captured[],
  /** `.returning()` fixtures per `tx.update` (the counter half), in call order. */
  txUpdateReturns: [] as unknown[][],
  /** WHEREs of every `tx.update` that was consumed. */
  txUpdates: [] as Captured[],
  /** Every `logAudit({…})` entry the handler wrote. */
  audits: [] as Record<string, unknown>[],
};

/**
 * A chainable Drizzle-shaped recorder: the same node drives both `.returning()`
 * (the fixed handlers claim their row) and a bare `await node` (origin/main's
 * UPDATE/DELETE awaited the WHERE-builder as a thenable, and that's the exact
 * code shape we want to be able to replay for the red demonstration).
 */
function makeNode(
  target: Captured[],
  queue: () => unknown[][],
): Record<string, unknown> {
  let rec: Captured = { sql: '', params: [], set: {} };
  const consume = (): unknown[] => {
    const at = target.length;
    target.push(rec);
    return queue()[at] ?? [];
  };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    where: (pred: unknown) => {
      const rendered = dialect.sqlToQuery(pred as never);
      rec = { sql: rendered.sql, params: rendered.params as unknown[], set: rec.set };
      return node;
    },
    returning: () => Promise.resolve(consume()),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(consume()).then(resolve),
  };
  return node;
}

const db: Record<string, unknown> = {
  update: () => makeNode(state.dbUpdates, () => state.updateReturns),
  select: () => {
    const builder: Record<string, unknown> = {};
    builder['from'] = () => builder;
    builder['where'] = () => builder;
    builder['limit'] = () => Promise.resolve(state.readRows);
    return builder;
  },
  query: {
    fileAttachments: { findFirst: async () => state.fileRow },
  },
  transaction: async (cb: (t: unknown) => Promise<unknown>) => {
    const tx: Record<string, unknown> = {
      delete: () => makeNode(state.txDeletes, () => state.txDeleteReturns),
      update: () => makeNode(state.txUpdates, () => state.txUpdateReturns),
    };
    return cb(tx);
  },
};

// `@/drizzle/db` is the ONLY handle these handlers touch the pool with; mock
// call counts cannot show a missing predicate, so `makeNode` renders each WHERE
// through `PgDialect` and the assertions below inspect real SQL.
vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((err: unknown) => { throw err; }),
}));
// The files route imports checkLimit at module scope even though only POST
// calls it; the mock keeps the module graph DB-free.
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: vi.fn(async () => undefined) }));
// #3194 does not touch S3; pretending it isn't configured keeps the DELETE path
// on the DB half, which is exactly what the fix is about.
vi.mock('@/lib/storage/s3-config', () => ({
  getS3Config: () => ({ region: 'us-east-1', bucket: 'nucrm-files-test' }),
  isS3Configured: () => false,
}));
// `concurrencyGuard` is deliberately NOT mocked (same choice as #3189): a
// PATCH that omits `expectedUpdatedAt` must fall through to null on the real
// code path, so the tenant predicate is the ONLY thing this write claims.

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  // PATCH's `buildEncryptedConfig` 503s when the env is unset; the test never
  // sends a client_secret, so the value is unused — just needs to be truthy.
  process.env.ENCRYPTION_KEY = 'test-key-3194-not-a-real-key';
  state.readRows = [];
  state.fileRow = null;
  state.updateReturns = [];
  state.dbUpdates = [];
  state.txDeleteReturns = [];
  state.txDeletes = [];
  state.txUpdateReturns = [];
  state.txUpdates = [];
  state.audits = [];
});

function existingProviderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROVIDER, tenantId: TENANT,
    config: { client_secret_enc: 'enc-existing-not-a-real-cipher' },
    ...over,
  };
}

function updatedProviderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROVIDER, providerType: 'oidc', name: 'Google Workspace',
    config: { issuer: 'https://accounts.google.test', client_id: 'cid-1' },
    isActive: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  };
}

function fileRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ATTACHMENT, tenantId: TENANT, filePath: `${TENANT}/deal/x.pdf`, fileSize: 4096,
    ...over,
  };
}

async function patchProvider(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/tenant/sso/providers/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/sso/providers/${PROVIDER}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: PROVIDER }) },
  );
}

async function deleteProvider(id: string = PROVIDER) {
  const { DELETE } = await import('@/app/api/tenant/sso/providers/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/sso/providers/${id}`, 'http://localhost:3000'), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id }) },
  );
}

async function deleteFile(id: string = ATTACHMENT) {
  const { DELETE } = await import('@/app/api/tenant/files/route');
  const req = new NextRequest(new URL(`/api/tenant/files?id=${id}`, 'http://localhost:3000'), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest, c: unknown) => Promise<NextResponse>)(req, undefined);
}

// ---------------------------------------------------------------------------
// Assertion helpers — the mutation must bite, not a mock call count.
// ---------------------------------------------------------------------------

const TENANT_SQL: Record<'sso' | 'files', RegExp> = {
  sso: /"sso_providers"\."tenant_id"/i,
  files: /"file_attachments"\."tenant_id"/i,
};
const ID_SQL: Record<'sso' | 'files', RegExp> = {
  sso: /"sso_providers"\."id"/i,
  files: /"file_attachments"\."id"/i,
};

function assertTenantClaimed(kind: 'sso' | 'files', c: Captured | undefined): void {
  expect(c, 'no guarded UPDATE/DELETE ran').toBeTruthy();
  expect(c!.sql, `id predicate missing from: ${c!.sql}`).toMatch(ID_SQL[kind]);
  expect(c!.sql, `tenant predicate missing from: ${c!.sql}`).toMatch(TENANT_SQL[kind]);
}

describe('#3194 — the writes name the tenant the read vetted against', () => {
  it('PATCH sso: the UPDATE WHERE carries both the row id and the caller tenant', async () => {
    state.readRows = [existingProviderRow()];
    state.updateReturns = [[updatedProviderRow()]];
    const res = await patchProvider({
      name: 'Google Workspace',
      issuer: 'https://accounts.google.test',
      client_id: 'cid-1',
      email_domains: ['example.test'],
    });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.dbUpdates).toHaveLength(1);
    assertTenantClaimed('sso', state.dbUpdates[0]);
    // Bound as parameters, never spliced: id first (the row the read vetted),
    // tenant second (the identity `requireAuth` proved), and the caller tenant —
    // NOT a tenant the body could steer.
    expect(state.dbUpdates[0].params[0]).toBe(PROVIDER);
    expect(state.dbUpdates[0].params).toContain(TENANT);
    expect(state.dbUpdates[0].params).not.toContain(OTHER_TENANT);
  });

  it('sso DELETE: the soft-delete UPDATE names the tenant AND reads the row back', async () => {
    state.readRows = [existingProviderRow()];
    state.updateReturns = [[{ id: PROVIDER }]];
    const res = await deleteProvider();
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said)).toEqual({ ok: true });
    expect(state.dbUpdates).toHaveLength(1);
    assertTenantClaimed('sso', state.dbUpdates[0]);
    // `.returning({ id })` was consumed — otherwise the handler cannot see the
    // zero-row race and cannot answer 404 below.
    expect(state.dbUpdates[0].set).toMatchObject({ isActive: false });
    expect(state.dbUpdates[0].set.deletedAt).toBeInstanceOf(Date);
  });

  it('sso DELETE: the write matches zero rows → 404, not the old unconditional ok:true', async () => {
    // The issue names this exact case: "the soft-delete UPDATE doesn't even
    // `.returning()`/zero-row-check: if the row vanished between read and
    // write, the caller is still told `{ ok: true }`." Postgres re-evaluates
    // WHERE under the row lock, so a row the pre-read saw but another writer
    // removed by the time the UPDATE lands matches zero rows.
    state.readRows = [existingProviderRow()];
    state.updateReturns = [[]];
    const res = await deleteProvider();
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(JSON.parse(said).error).toMatch(/not found/i);
  });

  it('files DELETE: the hard DELETE names the tenant AND reads the row back', async () => {
    state.fileRow = fileRow();
    state.txDeleteReturns = [[{ id: ATTACHMENT }]];
    const res = await deleteFile();
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said)).toEqual({ ok: true });
    expect(state.txDeletes).toHaveLength(1);
    assertTenantClaimed('files', state.txDeletes[0]);
    // The counter half only runs when the delete landed, and its WHERE names
    // the tenant the caller proved — this is the same claim the sibling writes
    // have carried for weeks (#2402 on `sequenceEnrollments`). The decrement
    // value itself rides in the `.set()` SQL expression, not the WHERE.
    expect(state.txUpdates).toHaveLength(1);
    expect(state.txUpdates[0].sql).toMatch(/"tenants"\."id"/i);
    expect(state.txUpdates[0].params).toEqual([TENANT]);
    // …and the audit row exists, because the delete really landed.
    expect(state.audits.map((a) => a.action)).toEqual(['delete']);
  });

  it('files DELETE: the write matches zero rows → 404, no counter decrement, no audit', async () => {
    // The row the pre-read found was removed between that read and this
    // statement. Before #3194 the transaction still ran the counter decrement
    // and the handler still answered `{ ok: true }` — a lie about the DB half.
    // S3 bytes are already gone above (that residual is honest; the issue says
    // "the S3 object is already deleted"), but the DB/counter half must not
    // claim a removal it did not make.
    state.fileRow = fileRow();
    state.txDeleteReturns = [[]];
    const res = await deleteFile();
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(JSON.parse(said).error).toMatch(/not found/i);
    expect(state.txDeletes).toHaveLength(1);
    assertTenantClaimed('files', state.txDeletes[0]);
    expect(state.txUpdates, 'the counter decrement ran for a row the delete did not remove').toEqual([]);
    expect(state.audits, 'a lost delete was audit-logged as if it landed').toEqual([]);
  });
});

describe('the assertions bite — proof for the reviewer', () => {
  // Without these, a reviewer cannot tell "my regex matched" from "my regex
  // matches anything". Both controls render through the same dialect the
  // recorder uses, and the tenant pattern is asserted absent.

  it('the sso predicate without the tenant clause does NOT satisfy the tenant regex', () => {
    const c = dialect.sqlToQuery(eq(ssoProviders.id, PROVIDER) as never);
    expect(c.sql).toMatch(ID_SQL.sso);
    expect(c.sql).not.toMatch(TENANT_SQL.sso);
    // Deleting `eq(ssoProviders.tenantId, ctx.tenantId)` from the route would
    // render exactly this string, so the `assertTenantClaimed` call above is
    // not merely a mock-call count.
  });

  it('the files predicate without the tenant clause does NOT satisfy the tenant regex', () => {
    const c = dialect.sqlToQuery(eq(fileAttachments.id, ATTACHMENT) as never);
    expect(c.sql).toMatch(ID_SQL.files);
    expect(c.sql).not.toMatch(TENANT_SQL.files);
  });

  it('the sso UPDATE that names a foreign tenant is not the caller tenant', async () => {
    // A refactor that swapped `ctx.tenantId` for a body-derived tenant would
    // still render the `"…tenant_id"` regex, so the params assertion above is
    // the second half of the guard. This test proves the handler reaches the
    // write only when its OWN read resolved to the caller's row.
    state.readRows = [existingProviderRow({ tenantId: OTHER_TENANT })];
    state.updateReturns = [[{ id: PROVIDER }]];
    const res = await deleteProvider();
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(state.dbUpdates, 'the write ran even though the read said other-tenant').toEqual([]);
  });
});

describe('legitimate same-tenant callers are unchanged', () => {
  it('a PATCH that omits expectedUpdatedAt still runs the concurrency guard, which passes', async () => {
    // `concurrencyGuard` is NOT stubbed: it must fall through to null on the
    // default client, so the tenant predicate is the ONLY thing this write
    // claims. Same proof #3189 pinned for the contract PUT.
    state.readRows = [existingProviderRow()];
    state.updateReturns = [[updatedProviderRow()]];
    const res = await patchProvider({
      name: 'Google Workspace',
      issuer: 'https://accounts.google.test',
      client_id: 'cid-1',
      email_domains: ['example.test'],
    });
    expect(res.status, await res.text()).toBe(200);
    expect(state.dbUpdates[0].params).not.toContain('expectedUpdatedAt');
  });

  it('the sso DELETE 404s before the write when the pre-read finds no row', async () => {
    // Existing JS-check unchanged: a missing row is a 404 from the read, and
    // the guarded write never runs. This is the "behaviour for legitimate
    // callers is unchanged" half of the acceptance.
    state.readRows = [];
    const res = await deleteProvider();
    expect(res.status, await res.text()).toBe(404);
    expect(state.dbUpdates).toEqual([]);
  });

  it('the files DELETE 404s before S3/transaction when the pre-read finds no row', async () => {
    state.fileRow = null;
    const res = await deleteFile();
    expect(res.status, await res.text()).toBe(404);
    expect(state.txDeletes).toEqual([]);
    expect(state.txUpdates).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('the sso PATCH keeps its 500 branch — an update whose claim lost still fails loudly', async () => {
    // The issue's Fix Shape §1: "the `!updated → 500` branch already exists and
    // stays." A row removed under us answers the same 500 it did before the
    // fix; the fix adds the tenant predicate, nothing else to this branch.
    state.readRows = [existingProviderRow()];
    state.updateReturns = [[]];
    const res = await patchProvider({
      name: 'Google Workspace',
      issuer: 'https://accounts.google.test',
      client_id: 'cid-1',
      email_domains: ['example.test'],
    });
    expect(res.status, await res.text()).toBe(500);
    expect(state.dbUpdates).toHaveLength(1);
    assertTenantClaimed('sso', state.dbUpdates[0]);
  });
});

describe('the and() predicate composes exactly the two clauses the issue names', () => {
  // Not a route test — a shape pin: the fix is `and(eq(id), eq(tenantId, …))`,
  // nothing else. If a refactor adds a status/from-set claim here (the #3184/
  // #3189 pattern), that is a separate decision the issue did not ask for;
  // sso_providers has no status column to claim.
  it('the sso WHERE has exactly two predicates, id and tenant_id', async () => {
    state.readRows = [existingProviderRow()];
    state.updateReturns = [[{ id: PROVIDER }]];
    await deleteProvider();
    const sql = state.dbUpdates[0].sql;
    // Split on the ` and ` joiner drizzle uses for `and(...)`.
    const parts = sql.split(/\s+and\s+/i);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/"sso_providers"\."id"/);
    expect(parts[1]).toMatch(/"sso_providers"\."tenant_id"/);
    expect(and(eq(ssoProviders.id, PROVIDER), eq(ssoProviders.tenantId, TENANT))).toBeTruthy();
  });

  it('the files WHERE has exactly two predicates, id and tenant_id', async () => {
    state.fileRow = fileRow();
    state.txDeleteReturns = [[{ id: ATTACHMENT }]];
    await deleteFile();
    const sql = state.txDeletes[0].sql;
    const parts = sql.split(/\s+and\s+/i);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/"file_attachments"\."id"/);
    expect(parts[1]).toMatch(/"file_attachments"\."tenant_id"/);
  });
});
