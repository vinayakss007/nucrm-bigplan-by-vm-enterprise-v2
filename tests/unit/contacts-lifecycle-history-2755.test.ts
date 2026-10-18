/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2755 — `POST /api/tenant/contacts/[id]/lifecycle` answers 500 and never records
 * a lifecycle transition, because the DB function it called cannot work.
 *
 * `SELECT public.update_contact_lifecycle(contact, stage, user, reason)` — the body is
 * `drizzle/migrations/0032_missing_db_functions.sql:236-238` — updates `contacts` and
 * then inserts the history row into **`contact_lifecycle_events`**. No migration ever
 * creates that table: the one that exists is `contact_lifecycle_history`
 * (`drizzle/migrations/0000_init.sql:363`, `drizzle/schema/crm.ts:691`), which this
 * route's own GET reads (`route.ts:160`). Measured by applying `0000_init.sql` and
 * `0032_missing_db_functions.sql` to a scratch PostgreSQL 16 cluster and calling the
 * function: `ERROR: relation "contact_lifecycle_events" does not exist` at line 4, and
 * because a plpgsql error aborts the whole function, the `UPDATE` rolled back with it —
 * `lifecycle_stage` stayed `lead` and `contact_lifecycle_history` stayed at 0 rows.
 * With the table hand-created, every row read back `customer|customer` for a lead moved
 * to customer: the function re-reads `lifecycle_stage` in its `INSERT … SELECT` *after*
 * the `UPDATE` already changed it, so `from_stage` is never the stage the contact came
 * from. Both defects survive a same-name rewrite, which is why the assertions below ask
 * for the pre-write value rather than for a shape the broken function could also satisfy.
 *
 * So a rep re-staging a contact got a 500 (`route.ts:127-129` → `apiError`) and no
 * history, while the response they would have got claimed the transition happened.
 *
 * The fix is the route's own write, in one transaction. These tests hold that: both
 * statements inside a single `db.transaction`, the history row carrying the stage the
 * existence read resolved *before* anything was written, and no call to the function at
 * all. The fake applies the update to the seeded row the way Postgres would, so a
 * `from_stage` taken after it is observable rather than assumed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect({} as never);

interface Row {
  id: string; tenantId: string; assignedTo: string | null; createdBy: string | null;
  deletedAt: Date | null; lifecycleStage: string;
}

let rows: Row[] = [];
let updates: { sql: string; params: unknown[] }[] = [];
let inserted: Record<string, unknown>[] = [];
let outsideTx = 0;
let inTx = false;
let body: Record<string, unknown> = {};

function render(fragment: unknown) {
  const q = dialect.sqlToQuery(fragment as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/** The contact the existence read resolves: same rule as #2752's file, kept small. */
function contactFor(where: { sql: string; params: unknown[] } | undefined): Row | undefined {
  if (!where) return undefined;
  const named = rows.find(r => where.params.includes(r.id));
  if (!named) return undefined;
  if (named.deletedAt !== null) return undefined;
  const narrowed = /\("contacts"\."assigned_to" = .* OR "contacts"\."created_by" = .*\)/i.test(where.sql)
    && where.params.filter(p => p === MINE).length >= 2;
  if (!narrowed) return named;
  return named.assignedTo === MINE || named.createdBy === MINE ? named : undefined;
}

const mockTx = {
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: (predicate: unknown) => {
        const where = render(predicate);
        updates.push(where);
        if (!inTx) outsideTx += 1;
        // Apply it: after this statement the row genuinely holds the new stage, so a
        // from_stage read from here on returns the wrong answer.
        const named = rows.find(r => where.params.includes(r.id));
        if (named) named.lifecycleStage = String(values.lifecycleStage);
        return Promise.resolve({ rows: [] });
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) => {
      inserted.push({ ...row, __table: table });
      if (!inTx) outsideTx += 1;
      return Promise.resolve({ rows: [] });
    },
  }),
};

const mockDb: Record<string, unknown> = {
  query: {
    contacts: {
      findFirst: vi.fn((options?: { where?: unknown }) =>
        contactFor(options && options.where !== undefined ? render(options.where) : undefined)),
    },
  },
  transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    inTx = true;
    try {
      await cb(mockTx);
    } finally {
      inTx = false;
    }
  }),
  execute: vi.fn(async (fragment: unknown) => {
    // What the real one does today: raise, abort, roll the UPDATE back.
    const rendered = render(fragment);
    if (/contact_lifecycle_events|update_contact_lifecycle/i.test(rendered.sql)) {
      return Promise.reject(new Error('relation "contact_lifecycle_events" does not exist'));
    }
    return Promise.resolve({ rows: [] });
  }),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return { ...actual, readJsonBody: async () => body };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const lifecycleRoute = await import('@/app/api/tenant/contacts/[id]/lifecycle/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: contacts.edit on, contacts.view_all off.
const REP = { 'contacts.view': true, 'contacts.edit': true };

async function post(ctx: AuthContext, id: string) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/contacts/${id}/lifecycle`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
  });
  return (lifecycleRoute.POST as (req: NextRequest, ctx?: unknown) => Promise<Response>)(
    req, { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  rows = [
    { id: OWNED, tenantId: TENANT, assignedTo: MINE, createdBy: MINE, deletedAt: null, lifecycleStage: 'lead' },
    { id: FOREIGN, tenantId: TENANT, assignedTo: OTHER, createdBy: OTHER, deletedAt: null, lifecycleStage: 'lead' },
  ];
  updates = [];
  inserted = [];
  outsideTx = 0;
  inTx = false;
  body = { lifecycle_stage: 'customer', reason: 'won the deal' };
  vi.clearAllMocks();
});

describe('the transition is recorded, not just claimed (#2755)', () => {
  it('a re-stage answers 200 instead of 500', async () => {
    const res = await post(ctxWith(REP), OWNED);
    const json = await res.json() as { ok?: boolean; error?: string };
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('the route no longer calls the function that cannot work', async () => {
    await post(ctxWith(REP), OWNED);
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it('one history row is written, and it carries the stage the contact came from', async () => {
    await post(ctxWith(REP), OWNED);
    expect(inserted).toHaveLength(1);
    // The fake applied the UPDATE, so the row really is 'customer' by now: a from_stage
    // taken after the write would read 'customer' and fail this.
    expect(rows.find(r => r.id === OWNED)!.lifecycleStage).toBe('customer');
    expect(inserted[0]!.fromStage).toBe('lead');
    expect(inserted[0]!.toStage).toBe('customer');
  });

  it('the history row is addressed to this tenant, contact and caller', async () => {
    await post(ctxWith(REP), OWNED);
    expect(inserted[0]!.tenantId).toBe(TENANT);
    expect(inserted[0]!.contactId).toBe(OWNED);
    expect(inserted[0]!.changedBy).toBe(MINE);
    expect(inserted[0]!.reason).toBe('won the deal');
  });

  it('both writes happen inside the transaction, so neither can land alone', async () => {
    await post(ctxWith(REP), OWNED);
    expect(outsideTx, 'a write ran outside db.transaction — the stage could change with no history row').toBe(0);
    expect(updates).toHaveLength(1);
    expect(inserted).toHaveLength(1);
  });

  it('the write still pins tenant and tombstone', async () => {
    await post(ctxWith(REP), OWNED);
    expect(updates[0]!.sql).toMatch(/"contacts"\."tenant_id"/i);
    expect(updates[0]!.sql).toMatch(/deleted_at/i);
    expect(updates[0]!.params).toContain(TENANT);
    expect(updates[0]!.params).toContain(OWNED);
  });

  it('an absent reason is stored as null, not as the string "undefined"', async () => {
    body = { lifecycle_stage: 'churned' };
    await post(ctxWith(REP), OWNED);
    expect(inserted[0]!.reason).toBeNull();
    expect(inserted[0]!.fromStage).toBe('lead');
    expect(inserted[0]!.toStage).toBe('churned');
  });
});

describe('a caller who cannot reach the contact still cannot write it (#2755 keeps #2752)', () => {
  it('a foreign contact is a 404 and opens no transaction', async () => {
    const res = await post(ctxWith(REP), FOREIGN);
    expect(res.status, await res.text()).toBe(404);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
    expect(rows.find(r => r.id === FOREIGN)!.lifecycleStage).toBe('lead');
  });
});
