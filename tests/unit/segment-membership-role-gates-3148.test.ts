/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3148 — five routes could rewrite segment membership for anybody's records.
 *
 * `POST /api/tenant/contacts/bulk` gates `add_to_segment` with
 * `requirePerm(ctx, 'contacts.edit')` (`contacts/bulk/route.ts:458-460`). The other four
 * bulk routes open that case with the payload read and nothing else — `tasks/bulk:339`,
 * `deals/bulk:470`, `leads/bulk:354`, `companies/bulk:280` — while every sibling case in
 * the same switch (`assign`, `delete`, `add_to_sequence`, …) checks its own permission
 * first. `GET|POST /api/tenant/segments/[id]/members` named no permission at all: `requireAuth`
 * was the only gate, POST deleted and re-inserted the whole member set and stamped
 * `last_refreshed_at` (`:106-124`).
 *
 * That is a write, and it is not inert: `segments/[id]/enroll/route.ts:82-84` reads exactly
 * that cache and turns each row into a `sequence_enrollments` entry, so the segment a rep
 * rebuilds is the audience the next enroll mail goes to.
 *
 * Asserted two ways. The behavioural half hands the real handler a session that lacks the
 * permission and requires the 403 before any `segment_members` write; the static half reads
 * every bulk route's source, because four identical copies of one case are exactly the shape
 * where a fifth can be added ungated and no behavioural test would notice.
 *
 * A `NextResponse` body is single-use, so each case reads it once into `said` and asserts on
 * the string — a second `await res.json()` after `await res.text()` fails the test, not the code.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROW = '33333333-3333-4333-8333-333333333333';
const SEG = '44444444-4444-4444-8444-444444444444';

let currentCtx: AuthContext | null = null;
let selectCall = 0;
let rowsPerCall: unknown[][] = [];
const inserted: { table: string; values: unknown }[] = [];
const txOps: string[] = [];
const mockDb = { select: vi.fn(), insert: vi.fn(), transaction: vi.fn() };

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  // Only `requireAuth` is faked — `can()`/`requirePerm()` are the rule under test.
  return { ...actual, requireAuth: vi.fn(async () => currentCtx ?? NextResponse.json({ error: 'unauthorized' }, { status: 401 })) };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
  enforceFieldRead: (_ctx: unknown, _entity: string, rows: unknown[]) => Promise.resolve(rows),
}));
vi.mock('@/lib/segments/evaluate', () => ({
  evaluateSegment: async () => [ROW, USER],
  isSegmentEntityType: () => true,
  SegmentFilterError: class SegmentFilterError extends Error {},
}));

// One row shape satisfies the id validation, the segment lookup and the
// `last_refreshed_at` read without each route needing its own fixture.
const DEFAULT_ROW = { id: ROW, entityType: 'contact', config: {}, lastRefreshedAt: null };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy']) builder[m] = chain;
  builder['where'] = chain;
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

function reset(rows: unknown[][] = []) {
  vi.resetModules();
  selectCall = 0;
  rowsPerCall = rows;
  inserted.length = 0;
  txOps.length = 0;
  mockDb.select.mockReset();
  mockDb.insert.mockReset();
  mockDb.transaction.mockReset();
  mockDb.select.mockImplementation(() => {
    const r = rowsPerCall[selectCall] ?? [DEFAULT_ROW];
    selectCall += 1;
    return makeBuilder(r);
  });
  mockDb.insert.mockImplementation((table: unknown) => {
    const record = { table: getTableName(table as never), values: undefined as unknown };
    inserted.push(record);
    const node: Record<string, unknown> = {
      values: (v: unknown) => {
        record.values = v;
        return node;
      },
      onConflictDoNothing: () => node,
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ rowCount: Array.isArray(record.values) ? record.values.length : 1 }),
    };
    return node;
  });
  mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      delete: () => ({ where: () => { txOps.push('delete'); return Promise.resolve(); } }),
      insert: () => ({
        values: (v: unknown) => {
          txOps.push(`insert:${Array.isArray(v) ? v.length : 1}`);
          return Promise.resolve();
        },
      }),
      update: () => ({ set: () => ({ where: () => { txOps.push('update'); return Promise.resolve(); } }) }),
    };
    return cb(tx);
  });
}

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// Spelled out per module: a template-literal specifier loses its extension to Vite and
// silently degrades to a runtime-only import.
const BULK_LOADERS: Record<string, () => Promise<unknown>> = {
  tasks: () => import('@/app/api/tenant/tasks/bulk/route'),
  deals: () => import('@/app/api/tenant/deals/bulk/route'),
  leads: () => import('@/app/api/tenant/leads/bulk/route'),
  companies: () => import('@/app/api/tenant/companies/bulk/route'),
  contacts: () => import('@/app/api/tenant/contacts/bulk/route'),
};

async function postBulk(module: string, idKey: string, body: Record<string, unknown>, ctx: AuthContext) {
  currentCtx = ctx;
  const { POST } = (await BULK_LOADERS[module]()) as {
    POST: (req: NextRequest, ctx?: unknown) => Promise<NextResponse>,
  };
  return POST(new NextRequest(new URL('/api/tenant/bulk', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ action: 'add_to_segment', [idKey]: [ROW], payload: { segment_id: SEG }, ...body }),
  }));
}

async function callMembers(method: 'GET' | 'POST', ctx: AuthContext) {
  currentCtx = ctx;
  const route = await import('@/app/api/tenant/segments/[id]/members/route');
  const req = new NextRequest(new URL(`/api/tenant/segments/${SEG}/members`, 'http://localhost:3000'), {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  const context = { params: Promise.resolve({ id: SEG }) };
  return method === 'GET'
    ? route.GET(req, context)
    : (route.POST as (r: NextRequest, c: unknown) => Promise<NextResponse>)(req, context);
}

// Every bulk route that has this case, and the permission each one must name.
// `contacts` names its ids `ids` and validates the body with a zod schema.
const BULK_SITES = [
  { module: 'tasks', idKey: 'task_ids', perm: 'tasks.edit', body: {} },
  { module: 'deals', idKey: 'deal_ids', perm: 'deals.edit', body: {} },
  { module: 'leads', idKey: 'lead_ids', perm: 'leads.edit', body: {} },
  { module: 'companies', idKey: 'company_ids', perm: 'companies.edit', body: {} },
  { module: 'contacts', idKey: 'contact_ids', perm: 'contacts.edit', body: { ids: [ROW], updates: {} } },
] as const;

describe('the add_to_segment case is gated in every bulk route that has it (#3148)', () => {
  it.each(BULK_SITES.map(s => [s.module, s.perm] as const))('%s: the case opens with requirePerm(%s)', (module, perm) => {
    const source = readFileSync(`app/api/tenant/${module}/bulk/route.ts`, 'utf8');
    const at = source.indexOf("case 'add_to_segment': {");
    expect(at, `${module}/bulk has no add_to_segment case`).toBeGreaterThan(-1);
    const opened = source
      .slice(at)
      .split('\n')
      .slice(1)
      .map(line => line.trim())
      .find(Boolean);
    expect(opened, `${module}/bulk add_to_segment is un-gated`).toBe(`const deny = requirePerm(ctx, '${perm}');`);
  });
});

describe('bulk add_to_segment refuses a role without the entity permission (#3148)', () => {
  it.each(BULK_SITES.map(s => [s.module, s.idKey, s.perm, s.body] as const))(
    '%s: 403, and no segment_members row is written',
    async (module, idKey, perm, body) => {
      reset();
      // The rep holds the entity's own `view` right and none of its `edit` — the
      // session that walked into the case before this fix.
      const res = await postBulk(module, idKey, body, ctxWith({ [`${perm.split('.')[0]}.view`]: true }));
      const said = await res.text();
      expect(res.status, said).toBe(403);
      expect(JSON.parse(said).error).toContain(perm);
      expect(inserted).toEqual([]);
    },
  );

  it('the permission still enrols: the case is gated, not removed', async () => {
    reset();
    const res = await postBulk('tasks', 'task_ids', {}, ctxWith({ 'tasks.edit': true }));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe('segment_members');
    expect(inserted[0].values).toEqual([{ segmentId: SEG, entityId: ROW, tenantId: TENANT }]);
    expect(JSON.parse(said)).toMatchObject({ ok: true, action: 'add_to_segment' });
  });

  it('an admin session is not narrowed by the new gate', async () => {
    reset();
    const res = await postBulk('deals', 'deal_ids', {}, {
      userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: {},
      isAdmin: true, isSuperAdmin: false,
    } as unknown as AuthContext);
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(inserted).toHaveLength(1);
  });
});

describe('segments/[id]/members is no longer reachable by any session (#3148)', () => {
  it('GET refuses a role without segments.view, before reading the cache', async () => {
    reset();
    const res = await callMembers('GET', ctxWith({ 'segments.manage': true }));
    const said = await res.text();
    expect(res.status, said).toBe(403);
    expect(JSON.parse(said).error).toContain('segments.view');
    expect(selectCall, 'the member list was still read').toBe(0);
  });

  it('POST refuses a role without segments.manage, before opening the transaction', async () => {
    reset();
    // `segments.view` is granted here: reading the cache must not buy the right to
    // replace it.
    const res = await callMembers('POST', ctxWith({ 'segments.view': true }));
    const said = await res.text();
    expect(res.status, said).toBe(403);
    expect(JSON.parse(said).error).toContain('segments.manage');
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(txOps).toEqual([]);
    expect(selectCall).toBe(0);
  });

  it('POST with segments.manage still replaces the cache and stamps it', async () => {
    reset();
    const res = await callMembers('POST', ctxWith({ 'segments.manage': true }));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(txOps).toEqual(['delete', 'insert:2', 'update']);
    expect(JSON.parse(said)).toMatchObject({ ok: true, data: { member_count: 2 } });
  });

  it('GET with segments.view still lists the members', async () => {
    reset([[DEFAULT_ROW], [{ entityId: ROW }]]);
    const res = await callMembers('GET', ctxWith({ 'segments.view': true }));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said)).toMatchObject({ data: [ROW], meta: { count: 1, entity_type: 'contact' } });
  });
});
