/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2698 — the contacts owner rule was one route away from being a suggestion.
 *
 * `contacts/[id]/route.ts:195-200` refuses to edit a contact the caller does
 * not own: without `contacts.view_all`, a row that is neither `assignedTo` nor
 * `createdBy` them answers 404. `sales_rep` holds exactly that combination
 * (`lib/permissions/definitions.ts:133` — `contacts.edit: true`,
 * `contacts.view_all: false`).
 *
 * Three sub-resource routes wrote the same row and checked only `contacts.edit`
 * — or, in `notes`' POST, nothing at all:
 *
 * | route | wrote | gate before |
 * | --- | --- | --- |
 * | `PATCH /contacts/[id]/status` | `lead_status` — the same column `:162` maps | `contacts.edit`, row read on `id + tenant_id` |
 * | `POST /contacts/[id]/notes` | an activity, plus `tx.update(contacts).set({ updatedAt })` | no `contacts.edit`, no owner check anywhere |
 * | `POST /contacts/[id]/enrich` | `metadata` + `updatedAt`, in an `UPDATE` keyed on the bare id | `contacts.edit`, row read on `id + tenant_id` |
 *
 * All three are live: `components/tenant/contact-detail-client.tsx:346` drives
 * status, `:316`/`:335` drive notes, and `lib/integrations/sdk.ts:104` exposes
 * notes to the public SDK. So the 404 was a detour around the same write.
 *
 * Asserted on status codes for the callers each route is supposed to refuse,
 * with `can()`/`requirePerm()` left real because those are the rules under
 * test — a mocked middleware would grade the mock. The manager and owner
 * controls matter as much as the rep cases: the writes must still work for the
 * people who are allowed to make them.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let owner: { assignedTo: string | null; createdBy: string | null } = { assignedTo: OTHER, createdBy: OTHER };
const mockDb: Record<string, unknown> = {
  select: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  query: { contacts: { findFirst: vi.fn() } },
};

function makeBuilder(resolved: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit', 'offset']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['returning'] = () => builder;
  builder['set'] = () => builder;
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(resolved);
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/notifications', () => ({ processMentions: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const status = await import('@/app/api/tenant/contacts/[id]/status/route');
const notes = await import('@/app/api/tenant/contacts/[id]/notes/route');
const enrich = await import('@/app/api/tenant/contacts/[id]/enrich/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function setup(permissions: Record<string, boolean>, as: { assignedTo?: string; createdBy?: string } = {}) {
  wheres = [];
  owner = { assignedTo: as.assignedTo ?? OTHER, createdBy: as.createdBy ?? OTHER };
  const row = {
    id: CONTACT, tenantId: TENANT, leadStatus: 'new', updatedAt: new Date('2026-01-01'),
    firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: null,
    jobTitle: null, metadata: {}, ...owner,
  };
  mockDb.select.mockImplementation(() => makeBuilder([row]));
  mockDb.update.mockImplementation(() => makeBuilder([row]));
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({
    update: () => makeBuilder([row]),
    insert: () => ({ values: () => makeBuilder([{ id: 'act-1' }]) }),
  }));
  (mockDb.query as { contacts: { findFirst: unknown } }).contacts.findFirst = vi.fn(async () => row);
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(permissions));
}

async function call(
  mod: Record<string, unknown>, method: 'PATCH' | 'POST', body?: unknown,
) {
  const handler = mod[method] as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  return handler(
    new NextRequest(new URL(`/api/tenant/contacts/${CONTACT}/${method === 'PATCH' ? 'status' : 'x'}`, 'http://localhost:3000'), {
      method,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: CONTACT }) },
  );
}

const REP = { 'contacts.view': true, 'contacts.edit': true };
const MANAGER = { ...REP, 'contacts.view_all': true };
const VIEWER = { 'contacts.view': true };

const STATUS_BODY = { lead_status: 'qualified' };
const NOTE_BODY = { content: 'Called about the renewal.', type: 'call' };

describe('a rep cannot write another rep\'s contact through a sub-route (#2698)', () => {
  it('PATCH /status answers 404 rather than moving its lead_status', async () => {
    setup(REP);
    const res = await call(status, 'PATCH', STATUS_BODY);
    expect(res.status, await res.text()).toBe(404);
  });

  it('POST /notes answers 404 rather than stamping the row', async () => {
    setup(REP);
    const res = await call(notes, 'POST', NOTE_BODY);
    expect(res.status, await res.text()).toBe(404);
  });

  it('POST /enrich answers 404 rather than overwriting its metadata', async () => {
    setup(REP);
    const res = await call(enrich, 'POST');
    expect(res.status, await res.text()).toBe(404);
  });

  it('notes asks for contacts.edit, which its siblings already did', async () => {
    setup(VIEWER);
    const res = await call(notes, 'POST', NOTE_BODY);
    expect(res.status, await res.text()).toBe(403);
  });
});

describe('the writes still work for the callers who may make them (#2698)', () => {
  it.each([
    ['status', 'PATCH', STATUS_BODY],
    ['notes', 'POST', NOTE_BODY],
    ['enrich', 'POST', undefined],
  ])('%s: a contact assigned to me is writable by a rep', async (which, method, body) => {
    setup(REP, { assignedTo: MINE });
    const res = await call(({ status, notes, enrich } as Record<string, unknown>)[which] as Record<string, unknown>, method, body);
    expect(res.status, await res.text()).toBeLessThan(400);
  });

  it.each([
    ['status', 'PATCH', STATUS_BODY],
    ['notes', 'POST', NOTE_BODY],
    ['enrich', 'POST', undefined],
  ])('%s: a contacts.view_all holder reaches any row', async (which, method, body) => {
    setup(MANAGER);
    const res = await call(({ status, notes, enrich } as Record<string, unknown>)[which] as Record<string, unknown>, method, body);
    expect(res.status, await res.text()).toBeLessThan(400);
  });
});

describe('enrich\'s write carries the tenant it was gated on (#2698)', () => {
  it('the UPDATE is keyed on id and tenant_id, not the bare id', async () => {
    setup(MANAGER);
    await call(enrich, 'POST');
    const written = wheres.filter(w => /"contacts"\."id"/.test(w.sql));
    expect(written.length, wheres.map(w => w.sql).join('\n')).toBeGreaterThan(0);
    for (const clause of written) {
      expect(clause.sql, clause.sql).toMatch(/"contacts"\."tenant_id"/);
      expect(clause.params).toContain(TENANT);
    }
  });
});
