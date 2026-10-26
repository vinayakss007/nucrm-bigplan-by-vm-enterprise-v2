/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2722 — GET /api/tenant/calls authenticates and then enforces nothing.
 *
 * `app/api/tenant/calls/route.ts:90-96` (at `9dcebcef`, before this change)
 * reads the session and follows it with:
 *
 *     if (!can(ctx, 'contacts.view_all')) {
 *       // Temporarily allow if they can at least view their own, but check later in filters
 *     }
 *
 * an empty block — the gate was started and abandoned. Every other verb on the
 * table gates on a permission: POST on `contacts.edit` (`:42-43`), PATCH on
 * `contacts.edit` (`[id]/route.ts:63-64`), DELETE on `contacts.delete`
 * (`[id]/route.ts:114-115`). And the house pattern for a collection read that
 * returns an entity's rows is to gate it on that entity's view rule —
 * `companies/route.ts:26` and `meetings/route.ts:23` both open their GET with
 * `requirePerm(ctx, '<entity>.view')`, as do the record reads
 * `contacts/[id]/route.ts:35` and `deals/[id]/route.ts:33`. The calls list,
 * which returns the contact's `firstName` / `lastName` / `email` alongside the
 * call's `notes`, `phoneNumber` and `recordedUrl` (`:129-136`), is the call
 * surface with no gate at all.
 *
 * The db double is a matcher rather than a queue: it renders each predicate
 * through drizzle's own dialect and only returns rows whose own column values
 * satisfy it, so a test cannot pass by pretending the query was scoped.
 *
 * Measured on `9dcebcef`: 7 of these 13 were red — a caller with `{}` as its
 * permissions got 200 with its own call's notes / phone / recording URL and the
 * contact's name and email, and `view_all` without `view` got the WHOLE tenant's
 * list. The 6 controls (a `contacts.view` holder's own rows, the owner
 * narrowing, the `view_all` list, admin passthrough, the `all` wildcard an API
 * key resolves to, POST's `contacts.edit` gate) were green before the change
 * and stay green after it.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const dialect = new PgDialect({} as never);

interface CallRow {
  id: string;
  tenantId: string;
  userId: string;
  notes: string;
  phoneNumber: string;
  recordedUrl: string;
  firstName: string;
  lastName: string;
  email: string;
  deletedAt: Date | null;
}

let rows: CallRow[] = [];
let preds: { sql: string; params: unknown[] }[] = [];

function rowSatisfies(p: { sql: string; params: unknown[] } | undefined, row: CallRow): boolean {
  if (!p) return true;
  if (/"call_logs"\."tenant_id"/.test(p.sql) && !p.params.includes(row.tenantId)) return false;
  if (/"call_logs"\."user_id"/.test(p.sql) && !p.params.includes(row.userId)) return false;
  if (/"call_logs"\."deleted_at" IS NULL/i.test(p.sql) && row.deletedAt !== null) return false;
  return true;
}

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  let own: { sql: string; params: unknown[] } | undefined;
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'returning', 'set']) {
    builder[m] = chain;
  }
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    own = { sql: rendered.sql, params: rendered.params };
    preds.push(own);
    return builder;
  };
  builder['then'] = (resolveFn: (v: unknown) => unknown) =>
    resolveFn(rows.filter(r => rowSatisfies(own, r)));
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(() => makeBuilder()),
  insert: vi.fn(() => makeBuilder()),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const collection = await import('@/app/api/tenant/calls/route');

function ctx(permissions: Record<string, boolean>, admin = false) {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: admin ? 'admin' : 'rep', permissions,
    isAdmin: admin, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function call(id: string, owner: string, who: string) {
  return {
    id,
    tenantId: TENANT,
    userId: owner,
    notes: `Renewal talk with ${who} — budget owner is her CFO.`,
    phoneNumber: `+1555000${id.slice(-4)}`,
    recordedUrl: `https://recordings.example.test/c/${id}`,
    firstName: who,
    lastName: 'Sharma',
    email: `${who.toLowerCase()}@example.test`,
    deletedAt: null,
  };
}

function setup(permissions: Record<string, boolean>, admin = false) {
  preds = [];
  (mockDb.select as ReturnType<typeof vi.fn>).mockClear();
  (mockDb.insert as ReturnType<typeof vi.fn>).mockClear();
  rows = [call('cccccccc-cccc-4ccc-8ccc-cccccccclive', MINE, 'Priya'),
          call('dddddddd-dddd-4ddd-8ddd-dddddddddead', OTHER, 'Rahul')];
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx(permissions, admin));
}

async function list(contactId?: string) {
  const url = new URL('http://localhost:3000/api/tenant/calls');
  if (contactId) url.searchParams.set('contact_id', contactId);
  return (collection.GET as (r: NextRequest) => Promise<Response>)(
    new NextRequest(url, { headers: { 'x-forwarded-for': '127.0.0.1' } }),
  );
}

async function body(res: Response) {
  const text = await res.text();
  return { text, json: JSON.parse(text) as { data?: CallRow[]; error?: string } };
}

describe('the calls list is gated on the read rule its siblings use (#2722)', () => {
  it('a caller with no contacts.view is refused', async () => {
    setup({});
    const res = await list();
    const { text } = await body(res);
    expect(res.status, text).toBe(403);
  });

  it('the refusal names the permission the route checks', async () => {
    setup({});
    const res = await list();
    const { text } = await body(res);
    expect(text.includes('contacts.view'), text).toBe(true);
  });

  it('a refused caller causes no query at all', async () => {
    setup({});
    await list();
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(preds).toHaveLength(0);
  });

  it('the refused response does not carry notes, numbers, recordings or contact emails', async () => {
    setup({});
    const res = await list();
    const { text } = await body(res);
    expect(text).not.toContain('budget owner is her CFO');
    expect(text).not.toContain('recordings.example.test');
    expect(text).not.toContain('priya@example.test');
    expect(text).not.toContain(' Rahul');
  });

  // The widest case the missing gate allows: `view_all` without `view` is a
  // combination an admin can save through POST /api/tenant/roles, and it is the
  // one that drops the owner narrowing at route.ts:116-118 as well.
  it('a contacts.view_all holder with no contacts.view does not get the tenant-wide list', async () => {
    setup({ 'contacts.view_all': true });
    const res = await list();
    const { text, json } = await body(res);
    expect(res.status, text).toBe(403);
    expect(json.data).toBeUndefined();
    expect(text).not.toContain('Rahul');
    expect(text).not.toContain('recordings.example.test');
  });

  it('a caller who can only see deals is still refused', async () => {
    setup({ 'deals.view': true, 'tasks.view': true });
    const res = await list();
    expect(res.status, await res.text()).toBe(403);
  });

  it('the gate runs before any filter is assembled', async () => {
    setup({});
    const res = await list('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(res.status, await res.text()).toBe(403);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe('the gate does not move the rules that already work (#2722)', () => {
  it('a contacts.view holder still gets their own logs back', async () => {
    setup({ 'contacts.view': true });
    const res = await list();
    const { json } = await body(res);
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.data?.map(r => r.id)).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccclive']);
  });

  it('the owner narrowing for a non-view_all caller is untouched', async () => {
    setup({ 'contacts.view': true });
    await list();
    const owner = preds.filter(p => /"call_logs"\."user_id"/.test(p.sql));
    expect(owner.length, JSON.stringify(preds)).toBeGreaterThan(0);
    expect(owner[0].params).toContain(MINE);
  });

  it('a contacts.view_all holder sees every log in the tenant', async () => {
    setup({ 'contacts.view': true, 'contacts.view_all': true });
    const res = await list();
    const { json } = await body(res);
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.data?.map(r => r.id).sort()).toEqual(
      ['cccccccc-cccc-4ccc-8ccc-cccccccclive', 'dddddddd-dddd-4ddd-8ddd-dddddddddead'].sort(),
    );
    for (const p of preds) expect(p.sql, p.sql).not.toMatch(/"call_logs"\."user_id"/);
  });

  it('an admin is let through by can(), as on every sibling route', async () => {
    setup({}, true);
    const res = await list();
    expect(res.status, await res.text()).toBe(200);
  });

  // The `ak_` path maps a key's scopes straight onto ctx.permissions
  // (lib/auth/api-key.ts:89-97), and `all` is what a `*` / `all` scope becomes,
  // so the seeded dev key (scripts/seed-dev.ts:1117-1126) keeps working through the
  // new gate exactly as it does through the companies/meetings ones.
  it('an API-key context with the `all` wildcard is let through', async () => {
    setup({ all: true });
    const res = await list();
    expect(res.status, await res.text()).toBe(200);
  });

  it('POST still gates on contacts.edit, not on the new read gate', async () => {
    setup({ 'contacts.view': true });
    const res = await (collection.POST as (r: NextRequest) => Promise<Response>)(
      new NextRequest(new URL('http://localhost:3000/api/tenant/calls'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
        body: JSON.stringify({ contact_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      }),
    );
    expect(res.status, await res.text()).toBe(403);
  });
});
