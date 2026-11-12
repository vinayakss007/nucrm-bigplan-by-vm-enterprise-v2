/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3407 — the seller's quote writers still force `status` from any state.
 *
 * #3159 guarded the offer lifecycle and #3177 the portal accept/decline, but the
 * two doors a seller actually uses were left on the old shape:
 *
 *   PUT /api/tenant/quotes/[id]          accepted `status` in its mutable set and
 *                                        wrote it with no from-state, so a late
 *                                        "declined" PATCH overwrote a buyer's
 *                                        acceptance and a cancelled/expired quote
 *                                        could be sent again;
 *   POST .../convert-to-invoice          wrote status='accepted' keyed on the id
 *                                        alone, so converting a declined/expired/
 *                                        cancelled/draft quote resurrected it.
 *
 * The fix reads the same `OFFER_TRANSITIONS` registry the public routes use and
 * folds the from-set into the UPDATE's WHERE. These tests pin both halves: the
 * rendered claim (through `PgDialect`, no database) and the handler's answer when
 * the claim matches zero rows — the race a mocked `db` can replay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const QUOTE = '55555555-5555-4555-8555-555555555555';
const INVOICE = '99999999-9999-4999-8999-999999999999';
const dialect = new PgDialect({} as never);

type UpdateRec = {
  table: string;
  set: Record<string, unknown>;
  where: unknown;
};

const H = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  /** `.returning()` rows for each update, in call order. */
  updateRows: [] as unknown[][],
  updates: [] as UpdateRec[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  txUpdates: [] as UpdateRec[],
  txCalls: 0,
  invoiceLookup: null as Record<string, unknown> | null,
  lineItems: [] as Record<string, unknown>[],
}));

function recordUpdate(table: unknown, sink: UpdateRec[]) {
  let rec: UpdateRec = { table: getTableName(table as never), set: {}, where: null };
  const node: Record<string, unknown> = {
    set: (values: Record<string, unknown>) => {
      rec = { ...rec, set: values };
      return node;
    },
    where: (predicate: unknown) => {
      rec = { ...rec, where: predicate };
      return node;
    },
    returning: () => {
      const at = sink.length;
      sink.push(rec);
      return Promise.resolve(H.updateRows[at] ?? []);
    },
  };
  return node;
}

const tx: Record<string, unknown> = {
  execute: vi.fn(async () => undefined),
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit']) {
      chain[method] = () => chain;
    }
    chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve([{ maxNum: 7 }]).then(resolve);
    return chain;
  }),
  insert: vi.fn((table: unknown) => ({
    values: () => {
      const name = getTableName(table as never);
      if (name === 'invoices') {
        return {
          returning: async () => [{ id: INVOICE, invoiceNumber: 'INV-00008', totalAmount: '100.00' }],
        };
      }
      return Promise.resolve();
    },
  })),
  update: vi.fn((table: unknown) => recordUpdate(table, H.txUpdates)),
};

const db: Record<string, unknown> = {
  query: {
    quotes: { findFirst: vi.fn(async () => H.existing) },
    invoices: { findFirst: vi.fn(async () => H.invoiceLookup) },
  },
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy']) {
      chain[method] = () => chain;
    }
    chain['limit'] = () => Promise.resolve(H.existing ? [H.existing] : []);
    chain['then'] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(H.lineItems).then(resolve);
    return chain;
  }),
  update: vi.fn((table: unknown) => recordUpdate(table, H.updates)),
  insert: vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      H.inserts.push({ table: getTableName(table as never), values });
      return Promise.resolve();
    },
  })),
  transaction: vi.fn(async (cb: (t: unknown) => unknown) => {
    H.txCalls += 1;
    return cb(tx);
  }),
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
  withApiRoute: <H>(handler: H): H => handler,
}));

vi.mock('@/lib/api/validate', () => ({
  readJsonBody: async (req: { json(): Promise<unknown> }) => req.json(),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: async () => null,
}));

vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  const { ConcurrencyError } = await import('@/lib/concurrency');
  return {
    apiError: (err: unknown) =>
      NR.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: err instanceof ConcurrencyError ? 409 : 500 },
      ),
  };
});

import { PUT as quotePUT } from '@/app/api/tenant/quotes/[id]/route';
import { POST as convertPOST } from '@/app/api/tenant/quotes/[id]/convert-to-invoice/route';

function putRequest(body: unknown): NextRequest {
  return new NextRequest(new URL(`/api/tenant/quotes/${QUOTE}`, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function convertRequest(): NextRequest {
  return new NextRequest(
    new URL(`/api/tenant/quotes/${QUOTE}/convert-to-invoice`, 'http://localhost:3000'),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  );
}

const put = async (body: unknown) =>
  quotePUT(putRequest(body), { params: Promise.resolve({ id: QUOTE }) });

const convert = async () =>
  convertPOST(convertRequest(), { params: Promise.resolve({ id: QUOTE }) });

function rendered(rec: UpdateRec): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(rec.where as never);
}

beforeEach(() => {
  H.existing = {
    id: QUOTE,
    status: 'accepted',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  };
  H.updateRows = [[{ id: QUOTE, status: 'accepted' }]];
  H.updates = [];
  H.inserts = [];
  H.txUpdates = [];
  H.txCalls = 0;
  H.invoiceLookup = null;
  H.lineItems = [{ id: 'line-1', description: 'Work', quantity: '1', unitPrice: '100.00' }];
});

describe('PUT /api/tenant/quotes/[id] — status is a transition (#3407)', () => {
  it('refuses accepted → declined before it writes anything', async () => {
    const res = await put({ status: 'declined' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "Quote cannot move from 'accepted' to 'declined'.",
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses a cancelled quote being sent again', async () => {
    H.existing = { id: QUOTE, status: 'cancelled', updatedAt: new Date() };

    const res = await put({ status: 'sent' });

    expect(res.status).toBe(409);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('claims the from-set in the WHERE for a legal transition', async () => {
    H.existing = { id: QUOTE, status: 'sent', updatedAt: new Date('2026-11-01T00:00:00Z') };

    const res = await put({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(H.updates).toHaveLength(1);
    expect(H.updates[0]!.set).toMatchObject({ status: 'accepted' });
    const { sql, params } = rendered(H.updates[0]!);
    expect(sql).toMatch(/"quotes"\."status" in \(\$\d+, \$\d+\)/);
    expect(params).toEqual(expect.arrayContaining(['sent', 'viewed']));
  });

  it('leaves a non-status edit unclaimed, so title edits still work from any state', async () => {
    H.existing = { id: QUOTE, status: 'accepted', updatedAt: new Date('2026-11-01T00:00:00Z') };

    const res = await put({ title: 'Renamed' });

    expect(res.status).toBe(200);
    const { sql } = rendered(H.updates[0]!);
    expect(sql).not.toContain('"status" in');
  });

  it('answers 409 when the from-state moved between the read and the write', async () => {
    H.existing = { id: QUOTE, status: 'sent', updatedAt: new Date('2026-11-01T00:00:00Z') };
    H.updateRows = [[]];

    const res = await put({ status: 'accepted' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('modified by another request') });
  });
});

describe('POST .../convert-to-invoice — only a live quote can be converted (#3407)', () => {
  it('refuses a declined quote before opening a transaction', async () => {
    H.existing = { id: QUOTE, status: 'declined', tenantId: TENANT };

    const res = await convert();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "Quote cannot be converted from 'declined'.",
    });
    expect(H.txCalls).toBe(0);
  });

  it('refuses a draft quote — acceptance is not implied by conversion', async () => {
    H.existing = { id: QUOTE, status: 'draft', tenantId: TENANT };

    const res = await convert();

    expect(res.status).toBe(409);
    expect(H.txCalls).toBe(0);
  });

  it('claims the accepted from-set and the tenant in the conversion write', async () => {
    H.existing = { id: QUOTE, status: 'sent', tenantId: TENANT };
    H.updateRows = [[{ id: QUOTE }]];

    const res = await convert();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, invoiceId: INVOICE });
    expect(H.txUpdates).toHaveLength(1);
    expect(H.txUpdates[0]!.set).toMatchObject({ status: 'accepted' });
    const { sql, params } = rendered(H.txUpdates[0]!);
    expect(sql).toMatch(/"quotes"\."status" in \(\$\d+, \$\d+, \$\d+\)/);
    expect(params).toEqual(expect.arrayContaining(['sent', 'viewed', 'accepted']));
    expect(sql).toMatch(/"quotes"\."tenant_id" = \$\d+/);
  });

  it('rolls the invoice insert back (409) when the quote moved mid-conversion', async () => {
    H.existing = { id: QUOTE, status: 'sent', tenantId: TENANT };
    H.updateRows = [[]];

    const res = await convert();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('modified by another request') });
    expect(H.txCalls).toBe(1);
    // The activity row is written only after a successful commit.
    expect(H.inserts.filter((i) => i.table === 'activities')).toHaveLength(0);
  });
});
