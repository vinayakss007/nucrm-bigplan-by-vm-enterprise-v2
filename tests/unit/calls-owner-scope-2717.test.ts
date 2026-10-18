/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2717 — the call-log owner rule lives on the read and not on the write.
 *
 * `app/api/tenant/calls/route.ts:116-117` narrows a caller without
 * `contacts.view_all` to `call_logs.user_id = ctx.userId`. The three writes on
 * the same table do not:
 *
 * | line | predicate |
 * | --- | --- |
 * | `[id]/route.ts:46-48` (PATCH existence read) | `id + tenant_id + deleted_at IS NULL` |
 * | `[id]/route.ts:62-64` (PATCH write) | `WHERE id` — the tenant term is dropped too |
 * | `[id]/route.ts:84-86` (DELETE write) | `id + tenant_id + deleted_at IS NULL` |
 *
 * The gate is `requirePerm(ctx, 'contacts.edit')` (`:34`), and `sales_rep` holds
 * `contacts.edit: true` with `contacts.view_all: false`
 * (`lib/permissions/definitions.ts:133`). `PATCH` then answers with
 * `.returning()` (`:62-67`), so a body of `{ "duration": 0 }` — every field of
 * `updateCallSchema` is `.optional()` (`:19-26`) — is a read primitive over the
 * other rep's `notes`, `phoneNumber` and `recordedUrl`, plus the `contactId` /
 * `dealId` of records that caller cannot open at all
 * (`contacts/[id]/route.ts:84` 404s them on the GET).
 *
 * `concurrencyGuard` at `:43` runs BEFORE the row is resolved against the
 * caller, and it 404s/409s off `id + tenant_id` alone — so for a foreign row the
 * route can confirm existence and disclose `updated_at` on a record the list
 * would never have shown. The owner rule has to be evaluated first.
 *
 * The db double here is a matcher, not a queue: it renders each predicate
 * through drizzle's own dialect and returns the row only if the row's own
 * column values satisfy it. A canned "found!" reader would have graded the mock
 * and passed with no owner term at all, which is precisely the bug.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CALL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTACT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect({} as never);

/** Only ever reached through a query the caller is allowed to run. */
const SECRET_NOTES = 'Renewal at 40k, budget owner is her CFO.';
const SECRET_PHONE = '+15550009999';
const SECRET_RECORDING = 'https://recordings.example.test/c/abc123';

interface Row {
  id: string; tenantId: string; userId: string; assignedTo: string | null;
  contactId: string; notes: string; phoneNumber: string; recordedUrl: string;
  duration: number; deletedAt: Date | null; updatedAt: Date;
}

let row: Row;
let preds: { kind: 'select' | 'update'; sql: string; params: unknown[] }[] = [];

/** Does the row's own data satisfy the predicate the route actually built? */
function rowSatisfies(p: { sql: string; params: unknown[] } | undefined): boolean {
  if (!p) return false;
  if (/"call_logs"\."id"/.test(p.sql) && !p.params.includes(row.id)) return false;
  if (/"call_logs"\."tenant_id"/.test(p.sql) && !p.params.includes(row.tenantId)) return false;
  if (/"call_logs"\."user_id"/.test(p.sql) && !p.params.includes(row.userId)) return false;
  if (/"call_logs"\."deleted_at" IS NULL/i.test(p.sql) && row.deletedAt !== null) return false;
  return true;
}

function makeBuilder(kind: 'select' | 'update') {
  const builder: Record<string, unknown> = {};
  let own: { sql: string; params: unknown[] } | undefined;
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'returning', 'set']) {
    builder[m] = chain;
  }
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    own = { sql: rendered.sql, params: rendered.params };
    preds.push({ kind, ...own });
    return builder;
  };
  builder['then'] = (resolveFn: (v: unknown) => unknown) =>
    resolveFn(rowSatisfies(own) ? [row] : []);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(() => makeBuilder('select')),
  update: vi.fn(() => makeBuilder('update')),
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
const byId = await import('@/app/api/tenant/calls/[id]/route');
const collection = await import('@/app/api/tenant/calls/route');

function ctx(permissions: Record<string, boolean>) {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

const REP = { 'contacts.view': true, 'contacts.edit': true };
const MANAGER = { ...REP, 'contacts.view_all': true };
const ADMIN = { ...MANAGER, 'contacts.delete': true };

function setup(permissions: Record<string, boolean>, as: 'mine' | 'other' = 'other') {
  preds = [];
  (mockDb.select as ReturnType<typeof vi.fn>).mockClear();
  (mockDb.update as ReturnType<typeof vi.fn>).mockClear();
  row = {
    id: CALL, tenantId: TENANT, userId: as === 'mine' ? MINE : OTHER, assignedTo: null,
    contactId: CONTACT, notes: SECRET_NOTES, phoneNumber: SECRET_PHONE,
    recordedUrl: SECRET_RECORDING, duration: 42, deletedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx(permissions));
}

async function patch(body: unknown, stale = false) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' };
  const payload: Record<string, unknown> = { ...body };
  if (stale) payload.expectedUpdatedAt = new Date('2025-01-01T00:00:00.000Z').toISOString();
  return (byId.PATCH as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
    new NextRequest(new URL(`http://localhost:3000/api/tenant/calls/${CALL}`), {
      method: 'PATCH', headers, body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: CALL }) },
  );
}

async function del() {
  return (byId.DELETE as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
    new NextRequest(new URL(`http://localhost:3000/api/tenant/calls/${CALL}`), {
      method: 'DELETE', headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
    { params: Promise.resolve({ id: CALL }) },
  );
}

function listPredicates() {
  return preds.filter(p => p.kind === 'select');
}

describe('a rep cannot edit or read back another rep\'s call log (#2717)', () => {
  it('PATCH answers 404 instead of returning the row', async () => {
    setup(REP);
    const res = await patch({ duration: 0 });
    expect(res.status, await res.text()).toBe(404);
  });

  it('the refused PATCH does not echo the notes, number or recording', async () => {
    setup(REP);
    const res = await patch({ duration: 0 });
    const text = await res.text();
    expect(text).not.toContain(SECRET_NOTES);
    expect(text).not.toContain(SECRET_PHONE);
    expect(text).not.toContain(SECRET_RECORDING);
  });

  it('a foreign row is refused before the concurrency guard can disclose it', async () => {
    setup(REP);
    const res = await patch({ duration: 0 }, true);
    expect(res.status, await res.text()).toBe(404);
  });

  it('DELETE answers 404 for a log the caller did not write', async () => {
    // No shipped preset reaches this — `contacts.delete` is a danger permission
    // and the `manager` preset drops every danger one (`definitions.ts:128-131`),
    // so today only a `view_all` holder can get here at all. The role is synthetic
    // on purpose: it is the case the scope on the DELETE predicate is for.
    setup({ ...REP, 'contacts.delete': true });
    const res = await del();
    expect(res.status, await res.text()).toBe(404);
  });

  it('DELETE still 403s a caller who lacks contacts.delete', async () => {
    setup(REP);
    const res = await del();
    expect(res.status, await res.text()).toBe(403);
  });

  it('no write is issued for the refused PATCH', async () => {
    setup(REP);
    await patch({ duration: 0 });
    expect(preds.filter(p => p.kind === 'update')).toHaveLength(0);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('the write carries the scope the read already applied (#2717)', () => {
  it('the UPDATE is keyed on id + tenant_id, not the bare id', async () => {
    setup(MANAGER);
    await patch({ duration: 7 });
    const updates = preds.filter(p => p.kind === 'update');
    expect(updates.length, JSON.stringify(preds)).toBeGreaterThan(0);
    for (const u of updates) {
      expect(u.sql, u.sql).toMatch(/"call_logs"\."tenant_id"/);
      expect(u.params).toContain(TENANT);
    }
  });

  it('a non-view_all caller\'s UPDATE is keyed on the owner too', async () => {
    setup(REP, 'mine');
    await patch({ duration: 7 });
    const updates = preds.filter(p => p.kind === 'update');
    expect(updates.length, JSON.stringify(preds)).toBeGreaterThan(0);
    for (const u of updates) {
      expect(u.sql, u.sql).toMatch(/"call_logs"\."user_id"/);
      expect(u.params).toContain(MINE);
    }
  });

  it('a contacts.view_all holder\'s SQL is unchanged — no owner term is minted for them', async () => {
    setup(MANAGER);
    await patch({ duration: 7 });
    for (const p of listPredicates()) {
      expect(p.sql, p.sql).not.toMatch(/"call_logs"\."user_id"/);
    }
  });
});

describe('the writes still work for the callers who may make them (#2717)', () => {
  it('a rep edits the call they logged', async () => {
    setup(REP, 'mine');
    const res = await patch({ notes: 'Left a voicemail.' });
    expect(res.status, await res.text()).toBe(200);
  });

  it('a contacts.view_all holder reaches any row in the tenant', async () => {
    setup(MANAGER);
    const res = await patch({ duration: 3 });
    expect(res.status, await res.text()).toBe(200);
  });

  it('a contacts.delete holder deletes a row they own', async () => {
    setup(ADMIN, 'mine');
    const res = await del();
    expect(res.status, await res.text()).toBe(200);
  });

  it('reordering the owner check ahead of the guard does not disable the guard', async () => {
    setup(REP, 'mine');
    const res = await patch({ duration: 3 }, true);
    expect(res.status, await res.text()).toBe(409);
  });
});

describe('the read rule the write must match is untouched (#2717)', () => {
  it('GET /calls narrows a non-view_all caller to their own logs', async () => {
    setup(REP);
    const res = await (collection.GET as (r: NextRequest) => Promise<Response>)(
      new NextRequest(new URL('http://localhost:3000/api/tenant/calls'), {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      }),
    );
    expect(res.status, await res.text()).toBe(200);
    const narrowed = preds.filter(p => /"call_logs"\."user_id"/.test(p.sql));
    expect(narrowed.length, JSON.stringify(preds)).toBeGreaterThan(0);
    expect(narrowed[0].params).toContain(MINE);
  });
});
