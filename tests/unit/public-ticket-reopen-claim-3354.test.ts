/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3354 — `POST /api/public/tickets/[id]/replies` read the ticket under
 * `id + tenant + contact + deletedAt IS NULL` inside the tenant transaction,
 * refused `closed` with 409, inserted the reply — and then reopened a
 * `resolved` ticket with `UPDATE supportTickets SET status='open' WHERE id=$1`
 * alone. No claim of the vetted from-state, no tenant or contact clause, no
 * tombstone gate, no read-back.
 *
 * So an agent closing (or deleting) the ticket between the read and the
 * UPDATE was silently undone by the portal reply, and the customer still got
 * 201. Fix: the reopen claims `status = 'resolved'` (the exact read value),
 * re-asserts tenant, contact and `deletedAt IS NULL`, and is read back; a
 * missed claim THROWS so `withTenantContext` aborts — the reply does not
 * commit against a state the handler never vetted — and POST answers 409.
 *
 * DB-free harness: the fake transaction journals each insert/update and only
 * flushes it to `committed` when the callback returns; a throw discards the
 * journal, which is what proves the reply is rolled back with the lost claim.
 * UPDATE WHEREs are rendered through `PgDialect`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const TICKET = '22222222-2222-2222-8222-222222222222';
const dialect = new PgDialect({} as never);

type Rendered = { sql: string; params: unknown[]; set?: Record<string, unknown> };

const state = {
  ticketRows: [] as unknown[],
  /** `.returning()` rows for the reopen UPDATE, consumed per call. */
  reopenReturns: [] as unknown[][],
  identity: null as null | { tenantId: string },
  pending: { inserts: [] as unknown[], updates: [] as Rendered[] },
  committed: { inserts: [] as unknown[], updates: [] as Rendered[] },
};

function makeTx() {
  const tx: Record<string, unknown> = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(state.ticketRows) }) }),
    }),
    insert: () => ({
      values: (row: unknown) => ({
        returning: () => {
          state.pending.inserts.push(row);
          return Promise.resolve([{ id: 'rep-1', ticketId: TICKET, body: 'thanks' }]);
        },
      }),
    }),
    update: () => {
      let rec: Rendered = { sql: '', params: [] };
      const node: Record<string, unknown> = {
        set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
        where: (pred: unknown) => {
          const rendered = dialect.sqlToQuery(pred as never);
          rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
          return node;
        },
        returning: () => {
          state.pending.updates.push(rec);
          return Promise.resolve(state.reopenReturns.shift() ?? []);
        },
      };
      return node;
    },
  };
  return tx;
}

vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: '00000000-0000-0000-0000-000000000000',
  // the real helper runs fn inside db.transaction: a throw rolls everything
  // back. The fake mirrors that by discarding the journal.
  withTenantContext: async (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.pending = { inserts: [], updates: [] };
    try {
      const out = await fn(makeTx());
      state.committed = state.pending;
      return out;
    } catch (err) {
      state.committed = { inserts: [], updates: [] };
      throw err;
    }
  },
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/portal-auth', () => ({
  resolvePortalIdentity: vi.fn(async () => state.identity),
  resolvePortalContact: vi.fn(async () => ({ id: CONTACT, tenantId: TENANT })),
}));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((err: unknown) => { throw err; }),
}));

beforeEach(() => {
  vi.resetModules();
  state.ticketRows = [];
  state.reopenReturns = [];
  state.identity = { tenantId: TENANT };
  state.pending = { inserts: [], updates: [] };
  state.committed = { inserts: [], updates: [] };
});

function ticketRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: TICKET, status: 'resolved', contactId: CONTACT, tenantId: TENANT, ...over };
}

async function post(body: unknown, id = TICKET) {
  const { POST } = await import('@/app/api/public/tickets/[id]/replies/route');
  const req = new NextRequest(new URL(`/api/public/tickets/${id}/replies`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (POST as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id }) },
  );
}

describe('the reopen claims the state the read vetted (#3354)', () => {
  it('the winning reopen carries the from-status claim, the tenant, the contact and the delete gate', async () => {
    state.ticketRows = [ticketRow({ status: 'resolved' })];
    state.reopenReturns = [[{ id: TICKET }]];
    const res = await post({ body: 'thanks' });
    const said = await res.text();
    expect(res.status, said).toBe(201);
    expect(state.committed.updates).toHaveLength(1);
    const up = state.committed.updates[0];
    expect(up.sql).toMatch(/"support_tickets"\."status" = /i);
    expect(up.sql).toMatch(/"support_tickets"\."tenant_id"/);
    expect(up.sql).toMatch(/"support_tickets"\."contact_id"/);
    expect(up.sql).toMatch(/"support_tickets"\."deleted_at" is null/i);
    expect(up.params).toEqual([TICKET, TENANT, CONTACT, 'resolved']);
    expect(up.set).toMatchObject({ status: 'open' });
    expect(state.committed.inserts).toHaveLength(1);
  });

  it('an agent close landing in the gap loses the claim — 409, and the reply is NOT written', async () => {
    // Read said `resolved`; PATCH /api/tenant/tickets/[id] then committed
    // `closed`. Pre-fix the UPDATE reopened the dead claim and the customer
    // got 201. Now the transaction aborts: nothing commits.
    state.ticketRows = [ticketRow({ status: 'resolved' })];
    state.reopenReturns = [[]];
    const res = await post({ body: 'thanks' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('concurrently');
    expect(JSON.parse(said).error).toContain('Reload and retry.');
    expect(state.committed.inserts, 'the reply committed against a state the handler never vetted').toEqual([]);
    expect(state.committed.updates).toEqual([]);
  });

  it('a tombstone landing in the gap loses the same way', async () => {
    state.ticketRows = [ticketRow({ status: 'resolved' })];
    state.reopenReturns = [[]];
    const res = await post({ body: 'thanks' });
    expect(res.status, await res.text()).toBe(409);
    // the delete gate is part of the claim, not just the status
    expect(state.pending.updates[0].sql).toMatch(/"support_tickets"\."deleted_at" is null/i);
    expect(state.committed.inserts).toEqual([]);
  });

  it('an open ticket is replied to without any reopen write', async () => {
    state.ticketRows = [ticketRow({ status: 'open' })];
    const res = await post({ body: 'ping' });
    const said = await res.text();
    expect(res.status, said).toBe(201);
    expect(state.committed.updates, 'a non-resolved ticket still triggered a status write').toEqual([]);
    expect(state.committed.inserts).toHaveLength(1);
  });
});

describe('what #3354 does not change', () => {
  it('a closed ticket is still refused with 409 before anything is written', async () => {
    state.ticketRows = [ticketRow({ status: 'closed' })];
    const res = await post({ body: 'hello?' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('closed');
    expect(state.committed.inserts).toEqual([]);
    expect(state.committed.updates).toEqual([]);
  });

  it('a ticket the caller cannot see is still 404', async () => {
    state.ticketRows = [];
    const res = await post({ body: 'x' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.committed.inserts).toEqual([]);
  });

  it('an anonymous caller is still 401', async () => {
    state.identity = null;
    const res = await post({ body: 'x' });
    expect(res.status, await res.text()).toBe(401);
    expect(state.committed.inserts).toEqual([]);
  });

  it('an empty body is still refused by the schema', async () => {
    const res = await post({ body: '' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(state.committed.inserts).toEqual([]);
  });
});
