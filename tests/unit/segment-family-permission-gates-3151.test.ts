/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3151 — the rest of the segment route family named no permission.
 *
 * `segments/route.ts` GET and POST, and `segments/[id]/route.ts` DELETE, ran on
 * `requireAuth` plus a tenant match and nothing else (verified at `b926b03b9`,
 * and again here at the head this PR branches from). Any session could therefore
 * read the filter definition of every segment in the workspace, create segments
 * nobody asked for, and hard-delete one — with no tombstone, and its
 * `segment_members` gone by the `onDelete: 'cascade'` FK
 * (`drizzle/schema/segments.ts:39`), so the bulk `restore` action has nothing to
 * bring back (#2291's trash model does not cover this route at all).
 *
 * The two writes take `segments.manage` ("Create/edit segments",
 * `lib/permissions/definitions.ts:120`), as the issue specifies.
 *
 * The list does NOT take a blanket `segments.view`, and the last describe block
 * pins why, because it is the kind of "obvious" gate a follow-up would re-add:
 * the same route is the input to the bulk `add_to_segment` dropdown on five list
 * pages, an action #3148 granted to `<entity>.edit` holders rather than to any
 * segments permission (`contacts/bulk/route.ts:458`, `tasks/bulk:339`, …). Those
 * five call sites are `r.ok ? r.json() : { data: [] }`
 * (`tasks-data-table.tsx:307-309`, `leads-client.tsx:170-172`,
 * `deals-data-table.tsx:290`, `companies-data-table.tsx:255`,
 * `contacts-data-table.tsx:352`) — a 403 there is not an error the rep sees, it
 * is an empty dropdown for the person who is allowed to use it. So the gate sits
 * on the one field that leaks (`config` → `filters`), which no consumer in the
 * app reads: the admin page renders `filter_count` only
 * (`app/tenant/segments/page.tsx:159`) and the pickers project `{id, name}`
 * (`tasks-data-table.tsx:294`).
 *
 * No database. `requireAuth` is the only mock that stands between this and the
 * real permission engine — `can()`/`requirePerm()` are the rule under test.
 * As in #3148, a `NextResponse` body is single-use: read it once into `said`.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEG = '44444444-4444-4444-8444-444444444444';

// The definition #3151 calls the leak: a revenue threshold plus an internal tag.
const CONFIG = { revenue: { gt: 50000 }, tags: ['churn-risk'] };

let currentCtx: AuthContext | null = null;
let selectRows: unknown[] = [];
const writes: { op: string; table: string; values: unknown }[] = [];
const mockDb = { select: vi.fn(), insert: vi.fn(), delete: vi.fn() };

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => currentCtx ?? NextResponse.json({ error: 'unauthorized' }, { status: 401 })) };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy', 'where']) builder[m] = chain;
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

/** `.values(v).returning(...)` — the shape both POST and DELETE use. */
function makeWrite(op: string, table: unknown, returning: unknown[]) {
  const record = { op, table: getTableName(table as never), values: undefined as unknown };
  writes.push(record);
  const node: Record<string, unknown> = {
    values: (v: unknown) => { record.values = v; return node; },
    where: () => node,
    returning: () => Promise.resolve(returning),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(returning).then(resolve),
  };
  return node;
}

function reset(opts: { rows?: unknown[]; returning?: unknown[] | null } = {}) {
  vi.resetModules();
  currentCtx = null;
  selectRows = opts.rows ?? [];
  writes.length = 0;
  const returning = opts.returning ?? [];
  mockDb.select.mockReset().mockImplementation(() => makeBuilder(selectRows));
  mockDb.insert.mockReset().mockImplementation((table: unknown) => makeWrite('insert', table, returning));
  mockDb.delete.mockReset().mockImplementation((table: unknown) => makeWrite('delete', table, returning));
}

function session(permissions: Record<string, boolean>, roleSlug = 'rep'): AuthContext {
  return {
    userId: USER, tenantId: TENANT, roleSlug, permissions,
    isAdmin: roleSlug === 'admin', isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function callList(method: 'GET' | 'POST', ctx: AuthContext, body: unknown = {}) {
  currentCtx = ctx;
  const route = await import('@/app/api/tenant/segments/route');
  const req = new NextRequest(new URL('/api/tenant/segments', 'http://localhost:3000'), {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
  return method === 'GET'
    ? (route.GET as (r: NextRequest) => Promise<NextResponse>)(req)
    : (route.POST as (r: NextRequest) => Promise<NextResponse>)(req);
}

async function callDelete(ctx: AuthContext, id = SEG) {
  currentCtx = ctx;
  const { DELETE } = await import('@/app/api/tenant/segments/[id]/route');
  return (DELETE as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    new NextRequest(new URL(`/api/tenant/segments/${id}`, 'http://localhost:3000'), {
      method: 'DELETE',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
    { params: Promise.resolve({ id }) },
  );
}

// The GET projection as drizzle returns it, one segment with a real definition.
const SEGMENT_ROW = {
  id: SEG,
  name: 'At-risk revenue',
  entityType: 'contact',
  description: 'Quarterly save list',
  config: CONFIG,
  createdAt: new Date('2026-01-05T00:00:00Z'),
};

describe('the segment list keeps its definitions off the wire (#3151)', () => {
  it('a session with no segments permission gets the list without the filter definition', async () => {
    reset({ rows: [SEGMENT_ROW] });
    const res = await callList('GET', session({}));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(said, 'the filter definition leaked').not.toContain('churn-risk');
    expect(said).not.toContain('50000');
    expect(JSON.parse(said).data).toEqual([{
      id: SEG,
      name: 'At-risk revenue',
      entity_type: 'contact',
      description: 'Quarterly save list',
      filters: {},
      // The count is not the secret: the page's badge stays truthful.
      filter_count: 2,
      created_at: '2026-01-05T00:00:00.000Z',
    }]);
  });

  it('segments.view is what buys the definition back', async () => {
    reset({ rows: [SEGMENT_ROW] });
    const res = await callList('GET', session({ 'segments.view': true }));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said).data[0].filters).toEqual(CONFIG);
  });

  it('an admin is not narrowed by the new gate', async () => {
    reset({ rows: [SEGMENT_ROW] });
    const res = await callList('GET', session({}, 'admin'));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said).data[0].filters).toEqual(CONFIG);
  });

  it('a holder of segments.manage alone still cannot read it: authoring is not reading', async () => {
    reset({ rows: [SEGMENT_ROW] });
    const res = await callList('GET', session({ 'segments.manage': true }));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said).data[0].filters).toEqual({});
  });

  it('it is still a select: the tenant match and the tombstone filter are untouched', async () => {
    reset({ rows: [SEGMENT_ROW] });
    const res = await callList('GET', session({ 'segments.view': true }));
    expect(res.status, await res.text()).toBe(200);
    // The mask must not arrive as a wider query — same single read, no rows dropped.
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });
});

describe('creating a segment is authoring, so it takes segments.manage (#3151)', () => {
  it('403 before the insert for a rep who can read segments', async () => {
    reset();
    const res = await callList('POST', session({ 'segments.view': true }),
      { name: 'Someday', entity_type: 'contacts', filters: CONFIG });
    const said = await res.text();
    expect(res.status, said).toBe(403);
    expect(JSON.parse(said).error).toContain('segments.manage');
    expect(writes).toEqual([]);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('the body is not even parsed on the way out', async () => {
    reset();
    // Malformed on purpose: a refusal that reaches `readJsonBody` first would
    // answer 400, and the gate would be observable only by its status code.
    currentCtx = session({});
    const { POST } = await import('@/app/api/tenant/segments/route');
    const req = new NextRequest(new URL('/api/tenant/segments', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: '{"name":',
    });
    const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(req);
    const said = await res.text();
    expect(res.status, said).toBe(403);
    expect(said).toContain('segments.manage');
  });

  it('segments.manage still creates, with the filters it was given', async () => {
    reset({ returning: [{ id: SEG, name: 'Someday', entityType: 'contact', description: null, config: CONFIG, createdAt: new Date('2026-02-01T00:00:00Z') }] });
    const res = await callList('POST', session({ 'segments.manage': true }),
      { name: 'Someday', entity_type: 'contacts', filters: CONFIG });
    const said = await res.text();
    expect(res.status, said).toBe(201);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(writes[0].table).toBe('segments');
    expect(writes[0].values).toMatchObject({ tenantId: TENANT, createdBy: USER, name: 'Someday', entityType: 'contact', config: CONFIG });
    expect(JSON.parse(said).data).toMatchObject({ id: SEG, name: 'Someday', filter_count: 2 });
  });
});

describe('hard-deleting a segment is authoring too (#3151)', () => {
  it('403 before anything is deleted', async () => {
    reset();
    const res = await callDelete(session({ 'segments.view': true }));
    const said = await res.text();
    expect(res.status, said).toBe(403);
    expect(JSON.parse(said).error).toContain('segments.manage');
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('the rep who could delete the whole team\'s list before this cannot, and the row is gone when they can', async () => {
    reset({ returning: [{ id: SEG, name: 'At-risk revenue' }] });
    const res = await callDelete(session({ 'segments.manage': true }));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(writes[0].table).toBe('segments');
    expect(JSON.parse(said)).toMatchObject({ ok: true });
  });

  it('a manage holder deleting across tenants still gets 404, not 200 (#2781 family intact)', async () => {
    reset({ returning: [] });
    const res = await callDelete(session({ 'segments.manage': true }));
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(JSON.parse(said).error).toBe('Segment not found');
  });
});

describe('the picker that feeds bulk add_to_segment is not refused (#3151)', () => {
  // The gate this PR did NOT add. Pinned because `segments.view` on the list
  // route reads like the completion of the set, and would silently empty the
  // dropdown of every `<entity>.edit` holder #3148 allowed to use it.
  const PICKER_SESSION = { 'contacts.view': true, 'contacts.edit': true };

  it('a contacts.edit session still gets 200 and its options', async () => {
    reset({ rows: [SEGMENT_ROW, { ...SEGMENT_ROW, id: USER, name: 'Biggest accounts', config: { mrr: { gt: 1000 } } }] });
    const res = await callList('GET', session(PICKER_SESSION));
    const said = await res.text();
    expect(res.status, said).toBe(200);
    const names = JSON.parse(said).data.map((s: { name: string }) => s.name);
    expect(names).toEqual(['At-risk revenue', 'Biggest accounts']);
  });

  it('and it still gets the ids it posts back as segment_id', async () => {
    reset({ rows: [SEGMENT_ROW] });
    const res = await callList('GET', session(PICKER_SESSION));
    const data = (await res.json()).data as { id: string }[];
    expect(data.map(s => s.id)).toEqual([SEG]);
  });
});
