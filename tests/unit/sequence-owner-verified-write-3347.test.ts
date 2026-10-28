/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3347 — `PATCH /api/tenant/sequences/[id]` never checked the sequence
 * belongs to the caller. Auth → perm → URL id → `concurrencyGuard` (whose
 * read finds no row for a foreign id and *passes*) → transaction. Inside it:
 *
 *  - the parent UPDATE was scoped id+tenant but never read back — a foreign
 *    or missing id answered 200;
 *  - the child DELETE was scoped ONLY by the URL-supplied `sequenceId` — no
 *    tenant clause — so a caller holding a foreign id wiped that sequence's
 *    steps wholesale (#3194: RLS is not a defense the write path may lean on);
 *  - the re-insert then grafted the attacker's step rows, tagged with the
 *    attacker's tenantId, under the victim's sequence id.
 *
 * Fix: verify the parent under `id + tenant + deletedAt IS NULL` before
 * anything else (404 otherwise); read back the parent UPDATE under the same
 * gates and skip the step rewrite when it matches zero rows (404); scope the
 * child delete by BOTH `sequenceId` AND `tenantId`.
 *
 * DB-free harness: every WHERE is rendered through `PgDialect` (a mock call
 * count cannot show a missing predicate), and `concurrencyGuard` is
 * deliberately NOT mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEQ = '22222222-2222-2222-8222-222222222222';
const dialect = new PgDialect({} as never);

type Rendered = { sql: string; params: unknown[]; set?: Record<string, unknown> };

const state = {
  /** Rows every pre-lock db SELECT resolves to (existence read, guard read). */
  readRows: [] as unknown[],
  /** `.returning()` rows for the parent UPDATE, consumed per call. */
  updateReturns: [] as unknown[][],
  txRan: false,
  updates: [] as Rendered[],
  deletes: [] as Rendered[],
  inserts: [] as unknown[][],
};

function makeUpdateNode(): Record<string, unknown> {
  let rec: Rendered = { sql: '', params: [] };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    where: (pred: unknown) => {
      const rendered = dialect.sqlToQuery(pred as never);
      rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
      return node;
    },
    returning: () => {
      state.updates.push(rec);
      return Promise.resolve(state.updateReturns.shift() ?? []);
    },
  };
  return node;
}

function makeSelectNode() {
  const builder: Record<string, unknown> = {};
  builder['from'] = () => builder;
  builder['where'] = () => builder;
  builder['limit'] = () => Promise.resolve(state.readRows);
  return builder;
}

function makeDeleteNode() {
  return {
    where: (pred: unknown) => {
      const rendered = dialect.sqlToQuery(pred as never);
      state.deletes.push(rendered);
      return Promise.resolve();
    },
  };
}

const tx: Record<string, unknown> = {
  update: makeUpdateNode,
  delete: makeDeleteNode,
  insert: () => ({
    values: (vals: unknown[]) => { state.inserts.push(vals); return Promise.resolve(); },
  }),
};

const db: Record<string, unknown> = {
  update: makeUpdateNode,
  select: makeSelectNode,
  transaction: async (fn: (t: Record<string, unknown>) => unknown) => {
    state.txRan = true;
    return fn(tx);
  },
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx), can: vi.fn(() => true) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  // real signature is synchronous: { data } | NextResponse
  validateBody: vi.fn((_schema: unknown, body: unknown) => ({ data: body })),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((err: unknown) => { throw err; }),
}));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'automations.manage': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.readRows = [];
  state.updateReturns = [];
  state.txRan = false;
  state.updates = [];
  state.deletes = [];
  state.inserts = [];
});

function seqRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SEQ, tenantId: TENANT, name: 'Onboarding', status: 'active',
    deletedAt: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  };
}

async function patch(body: Record<string, unknown>, id = SEQ) {
  const { PATCH } = await import('@/app/api/tenant/sequences/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/sequences/${id}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id }) },
  );
}

describe('the sequence is verified to belong to the caller before any write (#3347)', () => {
  it('a foreign sequence id is refused before the transaction — no delete, no graft', async () => {
    // The exact attack from the issue: attacker guesses/leaks a victim
    // sequenceId and PATCHes steps. The existence read (scoped id+tenant)
    // answers nothing; nothing may run.
    state.readRows = [];
    const res = await patch({ name: 'Mine now', steps: [{ type: 'email', subject: 'hi' }] }, '22222222-3333-4333-8333-333333333333');
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(state.txRan, 'the transaction ran against an unverified parent id').toBe(false);
    expect(state.deletes).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it('a soft-deleted sequence is refused the same way', async () => {
    state.readRows = [];
    const res = await patch({ steps: [] });
    expect(res.status, await res.text()).toBe(404);
    expect(state.txRan).toBe(false);
  });

  it('the step delete carries BOTH sequence_id and tenant_id', async () => {
    state.readRows = [seqRow()];
    state.updateReturns = [[{ id: SEQ }]];
    const res = await patch({ steps: [{ type: 'email', delay_minutes: 60, subject: 'hello', body: 'world' }] });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.deletes).toHaveLength(1);
    expect(state.deletes[0].sql).toMatch(/"sequence_steps"\."sequence_id"/i);
    expect(state.deletes[0].sql).toMatch(/"sequence_steps"\."tenant_id"/i);
    expect(state.deletes[0].params).toEqual([SEQ, TENANT]);
    // the grafted rows are this tenant's, under a parent verified as this tenant's
    expect(state.inserts[0]).toHaveLength(1);
    expect((state.inserts[0][0] as Record<string, unknown>).tenantId).toBe(TENANT);
  });

  it('the parent UPDATE keeps the tenant clause and the delete gate, and is read back', async () => {
    state.readRows = [seqRow()];
    state.updateReturns = [[{ id: SEQ }]];
    const res = await patch({ name: 'Renamed' });
    expect(res.status, await res.text()).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql).toMatch(/"sequences"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"sequences"\."deleted_at" is null/i);
    expect(state.updates[0].set).toMatchObject({ name: 'Renamed', updatedBy: USER });
  });

  it('a DELETE landing between the verification read and the tx loses the write race — 404, steps untouched', async () => {
    // Read said the sequence was live; #2392's DELETE then tombstoned it.
    // The parent UPDATE re-asserts the gates, matches zero rows, and the step
    // delete/insert pair must not run on the strength of a dead parent.
    state.readRows = [seqRow()];
    state.updateReturns = [[]];
    const res = await patch({ status: 'archived', steps: [{ type: 'email' }] });
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(state.deletes, 'the child delete ran against a parent that no longer exists live').toEqual([]);
    expect(state.inserts).toEqual([]);
  });
});

describe('what #3347 does not change', () => {
  it('a won edit with no steps updates the parent only', async () => {
    state.readRows = [seqRow()];
    state.updateReturns = [[{ id: SEQ }]];
    const res = await patch({ description: 'shorter description' });
    expect(res.status, await res.text()).toBe(200);
    expect(state.deletes, 'absent steps still triggered a child delete').toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it('an opted-in client whose updatedAt moved is refused before the transaction', async () => {
    // concurrencyGuard is REAL here, not stubbed.
    state.readRows = [seqRow({ updatedAt: new Date('2026-10-05T00:00:00.000Z') })];
    const res = await patch({ name: 'Stale', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(state.txRan).toBe(false);
  });

  it('the default client is covered: no expectedUpdatedAt, no opt-in, still verified', async () => {
    state.readRows = [];
    const res = await patch({ name: 'Nope' }, '22222222-9999-4999-8999-999999999999');
    expect(res.status, await res.text()).toBe(404);
    expect(state.txRan).toBe(false);
  });

  it('steps:[] deletes without re-inserting anything', async () => {
    state.readRows = [seqRow()];
    state.updateReturns = [[{ id: SEQ }]];
    const res = await patch({ steps: [] });
    expect(res.status, await res.text()).toBe(200);
    expect(state.deletes).toHaveLength(1);
    expect(state.inserts, 'an empty step list still inserted rows').toEqual([]);
  });
});
