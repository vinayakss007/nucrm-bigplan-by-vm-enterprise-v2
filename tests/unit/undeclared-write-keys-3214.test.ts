/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3214 — the two write sites #3212 left behind, found by re-running the same
 * measurement (every `.set({...})`/`.values({...})` key against the target
 * table's own column map) across the whole tree:
 *
 *   - `app/api/tenant/ai/activity/route.ts`  PATCH wrote `updatedAt` on
 *     `ai_activity`, which has no `updated_at` column (migration 0002 created
 *     the table ending at `created_at`; migration 0016 re-creates it
 *     `IF NOT EXISTS` *with* an `updated_at`, so the DDL never ran and the two
 *     definitions disagree). The same handler advertised optimistic concurrency
 *     through `concurrencyGuard`, which returns `null` immediately for any table
 *     lacking `updatedAt` — so the precondition could never fail, and the row
 *     would be written even if another user had just changed it.
 *   - `app/api/tenant/email-templates/route.ts` POST stamped `createdBy` on
 *     `email_templates`, which spreads `utils.lifecycle()`, not `utils.audit()`.
 *
 * In both cases `as Record<string, unknown>` / `as typeof ….$inferInsert` kept
 * tsc from objecting and Drizzle's mapper — which builds the SQL from the table's
 * column map, not from the object it was handed — kept the statement from
 * erroring. The write simply looked like it had recorded more than it did.
 *
 * Following #3212's accepted fix shape, the casts are gone so the column list is
 * compiler-enforced, the dead keys are dropped, and `expectedUpdatedAt` is
 * answered with an explicit 400 rather than silently ignored.
 *
 * The assertions are the #3212 ones: each handler's object is captured and handed
 * to a real Drizzle builder on the real table, and the rendered SQL must name a
 * column for every key. Plus one executable proof that the removed guard was
 * inert for `ai_activity` and live for a table that has the column.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { aiActivity } from '@/drizzle/schema/ai';
import { emailTemplates, savedViews } from '@/drizzle/schema';
import { concurrencyGuard } from '@/lib/api/concurrency';
import type { AuthContext } from '@/lib/auth/middleware';

// RFC 2606 `.test` fixtures and TEST-NET-style UUIDs only — this repo is public.
const TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTIVITY_ID = '99999999-9999-4999-8999-999999999999';
const TEMPLATE_ID = '44444444-4444-4444-8444-444444444444';

const dialect = new PgDialect({} as never);

/**
 * A real Dialect-backed builder so the assertions inspect Drizzle's own column
 * resolution rather than this file's reading of the schema. No connection is ever
 * attempted: `.toSQL()` renders lazily and port 1 on the loopback is a fixture.
 */
const renderDb = drizzle(new Pool({
  connectionString: 'postgres://nucrm_fix:nucrm_fix@127.0.0.1:1/nucrm.test',
}));

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** `.returning()` fixtures per `db.update`, in call order. */
  updateReturns: [] as unknown[][],
  /** `.returning()` fixtures per `db.insert`, in call order. */
  insertReturns: [] as unknown[][],
  /** Everything `db.update` was asked to write, in call order. */
  dbUpdates: [] as Captured[],
  /** Everything `db.insert` was asked to write, in call order. */
  dbInserts: [] as Captured[],
};

function makeNode(target: Captured[], queue: () => unknown[][]): Record<string, unknown> {
  let rec: Captured = { sql: '', params: [], set: {} };
  const consume = (): unknown[] => {
    const at = target.length;
    target.push(rec);
    return queue()[at] ?? [];
  };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    values: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
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
  insert: () => makeNode(state.dbInserts, () => state.insertReturns),
  select: () => {
    const builder: Record<string, unknown> = {};
    builder['from'] = () => builder;
    builder['where'] = () => builder;
    builder['limit'] = () => Promise.resolve([]);
    return builder;
  },
};

// `@/drizzle/db` is the only handle these handlers touch the pool with, and a
// mock call count cannot show a column that was never rendered. `@/lib/api/
// concurrency` is deliberately NOT mocked: the guard test below needs the real one.
vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  validateBody: vi.fn((_schema: unknown, raw: unknown) => ({ data: raw })),
}));
vi.mock('@/lib/ai/plan-gate', () => ({ requireAiFeature: async () => null }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => activeCtx), can: () => true };
});
vi.mock('@/lib/api-error', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-error')>('@/lib/api-error');
  return { ...actual, apiError: vi.fn((err: unknown) => { throw err; }) };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

const adminCtx = {
  userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

const nonAdminCtx = {
  userId: USER, tenantId: TENANT, roleSlug: 'member', permissions: {},
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

/** The identity `requireAuth` resolves for the handler under test. */
let activeCtx: AuthContext = adminCtx;

beforeEach(() => {
  vi.resetModules();
  activeCtx = adminCtx;
  state.updateReturns = [];
  state.insertReturns = [];
  state.dbUpdates = [];
  state.dbInserts = [];
});

/** drizzle property name -> rendered column name, for one table. */
function columnMapOf(table: unknown): Map<string, string> {
  const cols = (table as Record<symbol, Record<string, { name: string }>>)[Table.Symbol.Columns];
  const map = new Map<string, string>();
  for (const [key, col] of Object.entries(cols)) map.set(key, col.name);
  return map;
}

function renderUpdateSet(table: unknown, set: Record<string, unknown>): string {
  return (renderDb.update(table as never).set(set as never).toSQL().sql as string).toLowerCase();
}

function renderInsertValues(table: unknown, values: Record<string, unknown>): string {
  return (renderDb.insert(table as never).values(values as never).toSQL().sql as string).toLowerCase();
}

/** How each statement type spells a column it actually intends to write. */
type Mention = (column: string) => string;
const inUpdateSet: Mention = (column) => `"${column}" =`;
const inInsertColumnList: Mention = (column) => `"${column}"`;

/**
 * The load-bearing assertion from #3212: every key the handler handed to
 * `.set()`/`.values()` must be a column the table declares *and* must survive
 * Drizzle's own rendering. Re-adding a phantom key makes the captured object
 * grow without the SQL growing with it — exactly the failure mode that let this
 * class of bug ship twice.
 */
function expectNoUndeclaredColumns(
  table: unknown,
  captured: Captured,
  label: string,
  render: (t: unknown, s: Record<string, unknown>) => string,
  mention: Mention,
) {
  const map = columnMapOf(table);
  const rendered = render(table, captured.set);
  const keys = Object.keys(captured.set);
  expect(keys.length, `${label}: handler wrote an empty statement`).toBeGreaterThan(0);
  for (const key of keys) {
    expect(map.has(key), `${label}: "${key}" is not a column of ${label} — Drizzle renders it as nothing`).toBe(true);
    expect(rendered, `${label}: "${key}" did not survive into the rendered SQL`).toContain(mention(map.get(key)!));
  }
}

async function patchActivity(body: Record<string, unknown>, asCtx: AuthContext = adminCtx): Promise<NextResponse> {
  activeCtx = asCtx;
  const { PATCH } = await import('@/app/api/tenant/ai/activity/route');
  const req = new NextRequest(new URL('/api/tenant/ai/activity', 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: NextRequest) => Promise<NextResponse>)(req);
}

async function postTemplate(body: Record<string, unknown>, asCtx: AuthContext = adminCtx): Promise<NextResponse> {
  activeCtx = asCtx;
  const { POST } = await import('@/app/api/tenant/email-templates/route');
  const req = new NextRequest(new URL('/api/tenant/email-templates', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (POST as (r: NextRequest) => Promise<NextResponse>)(req);
}

describe('#3214 — ai/activity PATCH writes only columns ai_activity declares', () => {
  it('the PATCH SET clause names a real column for every key it was given', async () => {
    state.updateReturns = [[{ id: ACTIVITY_ID }]];

    const res = await patchActivity({ id: ACTIVITY_ID, accepted: true });
    expect(res.status).toBe(200);
    expect(state.dbUpdates).toHaveLength(1);
    expectNoUndeclaredColumns(aiActivity, state.dbUpdates[0], 'ai_activity', renderUpdateSet, inUpdateSet);
    expect(renderUpdateSet(aiActivity, state.dbUpdates[0].set)).toContain('"accepted" =');
  });

  it('it no longer claims to stamp an update time', async () => {
    state.updateReturns = [[{ id: ACTIVITY_ID }]];

    await patchActivity({ id: ACTIVITY_ID, accepted: false });
    expect(Object.keys(state.dbUpdates[0].set)).not.toContain('updatedAt');
  });

  it('ai_activity genuinely has no updated_at — that is the defect, not a reading error', () => {
    const names = [...columnMapOf(aiActivity).values()];
    expect(names, 'ai_activity grew an updated_at column — #3214 is now a DDL question, revisit it').not.toContain('updated_at');
    expect(names).toContain('created_at');
    expect(names).toContain('accepted');
  });

  it('a PATCH that still asks for the precondition is refused, not silently obeyed', async () => {
    state.updateReturns = [[{ id: ACTIVITY_ID }]];

    const res = await patchActivity({
      id: ACTIVITY_ID, accepted: true, expectedUpdatedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).error).toMatch(/updated_at/);
    expect(state.dbUpdates, 'a refused precondition must not also perform the write').toHaveLength(0);
  });

  it('keeps the tenant predicate, and pins the owner for a non-admin', async () => {
    state.updateReturns = [[{ id: ACTIVITY_ID }], [{ id: ACTIVITY_ID }]];
    // Second PATCH in this test, so `consume()` reads the queue at index 1.
    await patchActivity({ id: ACTIVITY_ID, accepted: true });
    const where = state.dbUpdates[0].sql.toLowerCase();
    expect(where).toContain('"id" =');
    expect(where).toContain('"tenant_id" =');
    expect(state.dbUpdates[0].params).toContain(TENANT);
    expect(where).not.toContain('"user_id" =');

    const asMember = await patchActivity({ id: ACTIVITY_ID, accepted: true }, nonAdminCtx);
    expect(asMember.status).toBe(200);
    expect(state.dbUpdates[1].sql.toLowerCase()).toContain('"user_id" =');
    expect(state.dbUpdates[1].params).toContain(USER);
  });

  it('a row that vanished since the scope check is not reported as rated', async () => {
    state.updateReturns = [[]];

    const res = await patchActivity({ id: ACTIVITY_ID, accepted: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Activity row not found' });
  });
});

describe('#3214 — the guard that was removed could never have fired', () => {
  /** A db stub that counts the reads the guard would need in order to decide. */
  function countingDb(rows: unknown[]): { db: Record<string, unknown>; selects: () => number } {
    let selects = 0;
    const stub: Record<string, unknown> = {
      select: () => {
        selects += 1;
        const builder: Record<string, unknown> = {};
        builder['from'] = () => builder;
        builder['where'] = () => builder;
        builder['limit'] = () => Promise.resolve(rows);
        return builder;
      },
    };
    return { db: stub, selects: () => selects };
  }

  it('returns null for ai_activity without even reading the row', async () => {
    const { db: stub, selects } = countingDb([{ updatedAt: new Date('2020-01-01T00:00:00Z') }]);

    const guard = await concurrencyGuard(
      stub as never, aiActivity as never, ACTIVITY_ID, TENANT, new Date('2026-01-01T00:00:00Z'),
    );

    // The client sent a precondition, the row it names has a different
    // timestamp, and the guard still waved the write through — because
    // `if (!idCol || !updatedAtCol) return null` short-circuits on a table with
    // no updated_at. There was no 409 to be had on this endpoint.
    expect(guard).toBeNull();
    expect(selects(), 'the guard short-circuits before any read').toBe(0);
  });

  it('control: the very same stub does detect the conflict on a table that has updated_at', async () => {
    const { db: stub, selects } = countingDb([{ updatedAt: new Date('2020-01-01T00:00:00Z') }]);

    const guard = await concurrencyGuard(
      stub as never, savedViews as never, ACTIVITY_ID, TENANT, new Date('2026-01-01T00:00:00Z'),
    );

    // So the inertness above is about ai_activity, not about the harness or
    // about the guard in general: an unambiguous stale write answers 409.
    expect(guard).not.toBeNull();
    expect(guard!.status).toBe(409);
    expect(selects()).toBe(1);
  });

  it('an unparseable precondition was already refused, so the new 400 does not loosen anything', async () => {
    const { db: stub } = countingDb([{ updatedAt: new Date('2020-01-01T00:00:00Z') }]);

    const guard = await concurrencyGuard(stub as never, savedViews as never, ACTIVITY_ID, TENANT, 'not-a-date');
    expect(guard).not.toBeNull();
    expect(guard!.status).toBe(400);
  });
});

describe('#3214 — email_templates POST writes only columns email_templates declares', () => {
  it('the INSERT column list is entirely made of declared columns', async () => {
    state.insertReturns = [[{ id: TEMPLATE_ID }]];

    const res = await postTemplate({ name: 'Welcome', subject: 'Hello', body: '<p>hi</p>', category: 'general' });
    expect(res.status).toBe(201);
    expect(state.dbInserts).toHaveLength(1);
    expectNoUndeclaredColumns(emailTemplates, state.dbInserts[0], 'email_templates', renderInsertValues, inInsertColumnList);
  });

  it('it no longer claims to record who created the template', async () => {
    state.insertReturns = [[{ id: TEMPLATE_ID }]];

    await postTemplate({ name: 'Welcome', subject: 'Hello', body: '<p>hi</p>' });
    expect(Object.keys(state.dbInserts[0].set)).not.toContain('createdBy');
  });

  it('email_templates spreads lifecycle(), not audit() — so created_by really is absent', () => {
    const names = [...columnMapOf(emailTemplates).values()];
    expect(names, 'email_templates grew a created_by column — #3214 site 2 is now a DDL question').not.toContain('created_by');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
  });

  it('the tenant comes from the session and a body-supplied attribution changes nothing', async () => {
    state.insertReturns = [[{ id: TEMPLATE_ID }]];

    const res = await postTemplate({
      name: 'Welcome', subject: 'Hello', body: '<p>hi</p>',
      tenantId: OTHER_TENANT, createdBy: OTHER_USER,
    });
    expect(res.status).toBe(201);
    expect(state.dbInserts[0].set.tenantId).toBe(TENANT);
    expect(Object.keys(state.dbInserts[0].set)).not.toContain('createdBy');
    expect(renderInsertValues(emailTemplates, state.dbInserts[0].set)).not.toContain('created_by');
  });
});

describe('#3214 — the checks bite (controls)', () => {
  it('main\'s own ai/activity write renders no updated_at, which is what the cross-check catches', () => {
    const asOnMain = { accepted: true, updatedAt: new Date() } as unknown as Record<string, unknown>;
    const rendered = renderUpdateSet(aiActivity, asOnMain);

    expect(rendered).toContain('"accepted" =');
    expect(rendered).not.toContain('updated_at');

    expect(() => expectNoUndeclaredColumns(aiActivity, { sql: '', params: [], set: asOnMain }, 'ai_activity', renderUpdateSet, inUpdateSet))
      .toThrow(/not a column/);
  });

  it('main\'s own email-templates write renders no created_by', () => {
    const asOnMain = {
      tenantId: TENANT, name: 'Welcome', subject: 'Hello', bodyHtml: '<p>hi</p>',
      category: 'general', createdBy: USER,
    } as unknown as Record<string, unknown>;
    const rendered = renderInsertValues(emailTemplates, asOnMain);

    expect(rendered).toContain('"body_html"');
    expect(rendered).not.toContain('created_by');

    expect(() => expectNoUndeclaredColumns(emailTemplates, { sql: '', params: [], set: asOnMain }, 'email_templates', renderInsertValues, inInsertColumnList))
      .toThrow(/not a column/);
  });
});
