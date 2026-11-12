/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3407 — the ticket PATCH was an unguarded status assignment.
 *
 * `PATCH /api/tenant/tickets/[id]` accepted `status` from any state and wrote
 * it with `WHERE id + tenant` alone. `concurrencyGuard` is opt-in (the detail
 * page and kanban send no `expectedUpdatedAt`) and its own read is a separate
 * statement, so a stale "resolved" click could overwrite a concurrent
 * close/reopen, and re-clicking "Resolved" minted another CSAT survey.
 *
 * The fix reads the current state, vets the move against `TICKET_TRANSITIONS`,
 * and folds the exact from-state into the UPDATE's WHERE. These tests pin both
 * halves: the rendered claim (through `PgDialect`, no database) and the
 * handler's answer when the claim matches zero rows — the race a mocked `db`
 * can replay. They also pin the schema split that stopped `.partial()` from
 * applying the create defaults to every PATCH.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const TICKET = '55555555-5555-4555-8555-555555555555';
const CONTACT = '77777777-7777-4777-8777-777777777777';
const dialect = new PgDialect({} as never);

type UpdateRec = {
  table: string;
  set: Record<string, unknown>;
  sql: string;
  params: unknown[];
};

const H = vi.hoisted(() => ({
  /** Rows for each outer `db.select(...).limit()`, in call order. */
  outerSelects: [] as unknown[][],
  /** Rows for each `tx.select(...).limit()` (CSAT ticket, then contact). */
  txSelects: [] as unknown[][],
  /** `.returning()` rows for each transaction UPDATE, in call order. */
  updateReturns: [] as unknown[][],
  updates: [] as UpdateRec[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  emails: [] as Record<string, unknown>[],
}));

function recordUpdate(table: unknown, sink: UpdateRec[]): Record<string, unknown> {
  let rec: UpdateRec = { table: getTableName(table as never), set: {}, sql: '', params: [] };
  const node: Record<string, unknown> = {
    set: (values: Record<string, unknown>) => {
      rec = { ...rec, set: values };
      return node;
    },
    where: (predicate: unknown) => {
      const rendered = dialect.sqlToQuery(predicate as never);
      rec = { ...rec, sql: rendered.sql, params: rendered.params };
      return node;
    },
    returning: () => {
      sink.push(rec);
      return Promise.resolve(H.updateReturns.shift() ?? []);
    },
  };
  return node;
}

const tx: Record<string, unknown> = {
  update: vi.fn((table: unknown) => recordUpdate(table, H.updates)),
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'where']) chain[method] = () => chain;
    chain['limit'] = () => Promise.resolve(H.txSelects.shift() ?? []);
    return chain;
  }),
  insert: vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      H.inserts.push({ table: getTableName(table as never), values });
      return Promise.resolve();
    },
  })),
};

const db: Record<string, unknown> = {
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'where']) chain[method] = () => chain;
    chain['limit'] = () => Promise.resolve(H.outerSelects.shift() ?? []);
    return chain;
  }),
  transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
};

// The factory is hoisted above the `db` literal; the proxy defers the read
// until the route actually calls a method, which is after this module body ran.
vi.mock('@/drizzle/db', () => ({
  db: new Proxy({}, {
    get: (_target, property) => (db as Record<string | symbol, unknown>)[property],
  }),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: TENANT, userId: USER }),
  requirePerm: () => null,
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T>(handler: T): T => handler,
}));

vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return {
    ...actual,
    readJsonBody: async (req: { json(): Promise<unknown> }) => req.json(),
  };
});

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: async () => null,
}));

vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async (message: Record<string, unknown>) => {
    H.emails.push(message);
    return { success: true };
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    apiError: (err: unknown) =>
      NR.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
  };
});

import { PATCH } from '@/app/api/tenant/tickets/[id]/route';
import { updateTicketSchema } from '@/lib/api/schemas/support';
import { allowedTicketFromStatus, canTransitionTicket } from '@/lib/tickets';

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL(`/api/tenant/tickets/${TICKET}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const patch = async (body: unknown) =>
  PATCH(patchRequest(body), { params: Promise.resolve({ id: TICKET }) });

function existing(status: string): Record<string, unknown> {
  return { id: TICKET, status };
}

function ticketRow(status: string): Record<string, unknown> {
  return {
    id: TICKET,
    subject: 'Printer down',
    body: 'It is on fire',
    status,
    priority: 'medium',
    category: 'general',
    assignedTo: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
  };
}

beforeEach(() => {
  H.outerSelects = [];
  H.txSelects = [];
  H.updateReturns = [];
  H.updates = [];
  H.inserts = [];
  H.emails = [];
});

describe('#3407 ticket PATCH — status claim', () => {
  it('claims the exact status it read when the payload writes status', async () => {
    H.outerSelects = [[existing('open')], [ticketRow('in_progress')]];
    H.updateReturns = [[{ id: TICKET }]];

    const res = await patch({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(H.updates).toHaveLength(1);
    expect(H.updates[0].set.status).toBe('in_progress');
    expect(H.updates[0].sql).toContain('"support_tickets"."status" =');
    expect(H.updates[0].params).toContain('open');
    expect(H.updates[0].sql).toContain('"support_tickets"."deleted_at" is null');
  });

  it('does not claim status when the payload only changes another field', async () => {
    H.outerSelects = [[existing('open')], [ticketRow('open')]];
    H.updateReturns = [[{ id: TICKET }]];

    const res = await patch({ priority: 'high' });

    expect(res.status).toBe(200);
    expect(H.updates).toHaveLength(1);
    expect(H.updates[0].set.priority).toBe('high');
    // The create defaults used to leak through `.partial()` here: a priority
    // edit also wrote status:'open' and tags:[].
    expect(H.updates[0].set.status).toBeUndefined();
    expect(H.updates[0].set.tags).toBeUndefined();
    expect(H.updates[0].sql).not.toContain('"support_tickets"."status" =');
  });

  it('refuses an illegal move before writing', async () => {
    H.outerSelects = [[existing('resolved')]];

    const res = await patch({ status: 'waiting' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("cannot move from 'resolved' to 'waiting'");
    expect(H.updates).toHaveLength(0);
  });

  it('keeps closed terminal except for an explicit reopen', async () => {
    H.outerSelects = [[existing('closed')]];

    const res = await patch({ status: 'resolved' });

    expect(res.status).toBe(400);
    expect(H.updates).toHaveLength(0);
    expect(canTransitionTicket('closed', 'open')).toBe(true);
    expect(canTransitionTicket('closed', 'in_progress')).toBe(true);
  });

  it('reopens a closed ticket by claiming closed', async () => {
    H.outerSelects = [[existing('closed')], [ticketRow('open')]];
    H.updateReturns = [[{ id: TICKET }]];

    const res = await patch({ status: 'open' });

    expect(res.status).toBe(200);
    expect(H.updates[0].set.status).toBe('open');
    expect(H.updates[0].params).toContain('closed');
  });

  it('rejects a body with no writable field instead of handing Drizzle an empty set', async () => {
    H.outerSelects = [[existing('open')]];

    const res = await patch({});

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No valid fields');
    expect(H.updates).toHaveLength(0);
  });

  it('answers 409 when a concurrent transition wins the claim', async () => {
    H.outerSelects = [[existing('open')]];
    H.updateReturns = [[]];

    const res = await patch({ status: 'resolved' });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('changed concurrently');
    expect(H.updates).toHaveLength(1);
    // The lost claim must stop before the survey insert and the outbound email.
    expect(H.inserts).toHaveLength(0);
    expect(H.emails).toHaveLength(0);
  });

  it('answers 404 when the ticket is soft-deleted under the request', async () => {
    H.outerSelects = [[]];

    const res = await patch({ status: 'in_progress' });

    expect(res.status).toBe(404);
    expect(H.updates).toHaveLength(0);
  });
});

describe('#3407 ticket PATCH — resolved effects', () => {
  it('mints one survey and sends one email on a real move into resolved', async () => {
    H.outerSelects = [[existing('open')], [ticketRow('resolved')]];
    H.updateReturns = [[{ id: TICKET }]];
    H.txSelects = [
      [{ contactId: CONTACT, subject: 'Printer down' }],
      [{ email: 'customer@example.com', firstName: 'Ada' }],
    ];

    const res = await patch({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(H.inserts).toHaveLength(1);
    expect(H.inserts[0].table).toBe('csat_surveys');
    expect(H.inserts[0].values).toMatchObject({
      tenantId: TENANT,
      ticketId: TICKET,
      contactId: CONTACT,
    });
    expect(H.emails).toHaveLength(1);
    expect(H.emails[0].to).toBe('customer@example.com');
  });

  it('does not mint a second survey when the ticket is already resolved', async () => {
    H.outerSelects = [[existing('resolved')], [ticketRow('resolved')]];
    H.updateReturns = [[{ id: TICKET }]];

    const res = await patch({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(H.inserts).toHaveLength(0);
    expect(H.emails).toHaveLength(0);
  });
});

describe('#3407 ticket status vocabulary', () => {
  it('accepts the DB CHECK vocabulary and rejects the two values it never had', () => {
    expect(updateTicketSchema.safeParse({ status: 'waiting' }).success).toBe(true);
    expect(updateTicketSchema.safeParse({ status: 'pending_customer' }).success).toBe(true);
    expect(updateTicketSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(updateTicketSchema.safeParse({ status: 'awaiting_customer' }).success).toBe(false);
  });

  it('derives the from-set from the one transition table', () => {
    expect(allowedTicketFromStatus('open')).toContain('closed');
    expect(allowedTicketFromStatus('waiting')).toContain('open');
    expect(allowedTicketFromStatus('waiting')).not.toContain('resolved');
    expect(allowedTicketFromStatus('not-a-status')).toEqual([]);
  });
});
