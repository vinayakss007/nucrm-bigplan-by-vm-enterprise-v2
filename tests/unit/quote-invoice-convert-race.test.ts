/**
 * Tests for POST /api/tenant/quotes/[id]/convert-to-invoice — issue #2228
 * (constraint requested by #2257).
 *
 * The "already converted?" SELECT sits OUTSIDE the db.transaction, and until
 * migration 0108 added the partial unique index uq_invoices_quote_id nothing
 * in the DB stopped two concurrent POSTs from each inserting an invoice for
 * one quote — and the route's 23505-retry loop could never fire because no
 * constraint existed. Now the index is the arbiter: the loser of the race
 * must answer 409 + the winner's invoice id, NOT a 500, and must NOT spin the
 * retry loop (every retry would violate the same quote constraint).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const QUOTE_ID = 'c3333333-3333-4333-8333-333333333333';
const WINNER_INVOICE = 'd4444444-4444-4444-8444-444444444444';

const m = vi.hoisted(() => {
  const state = {
    txCalls: 0,
    // invoices found by each db.query.invoices.findFirst call, in order
    invoiceLookupQueue: [] as Array<Record<string, unknown> | null>,
    txMode: 'succeed' as 'succeed' | 'quote23505' | 'number23505-then-succeed',
  };

  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve([{ maxNum: 7 }]);
      return chain;
    }),
    insert: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.values = () => ({
        returning: async () => [
          { id: 'inv-new', invoiceNumber: 'INV-00008', totalAmount: '100.00' },
        ],
      });
      return chain;
    }),
    update: vi.fn(() => ({
      set: () => ({ where: vi.fn(async () => undefined) }),
    })),
  };

  const db = {
    query: {
      quotes: {
        findFirst: vi.fn(async () => ({
          id: QUOTE_ID,
          tenantId: TENANT,
          title: 'Q1 services',
          contactId: 'contact-1',
          companyId: null,
          dealId: null,
          subtotal: '100.00',
          discount: '0',
          tax: '0',
          totalAmount: '100.00',
          notes: null,
          terms: null,
        })),
      },
      invoices: {
        findFirst: vi.fn(async () => {
          const next = state.invoiceLookupQueue.shift();
          return next === undefined ? null : next;
        }),
      },
    },
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve([]);
      return chain;
    }),
    insert: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.values = () => Promise.resolve(undefined);
      return chain;
    }),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => {
      state.txCalls += 1;
      if (state.txMode === 'quote23505') {
        const err = Object.assign(
          new Error('duplicate key value violates unique constraint "uq_invoices_quote_id"'),
          { code: '23505', constraint: 'uq_invoices_quote_id' },
        );
        throw err;
      }
      if (state.txMode === 'number23505-then-succeed' && state.txCalls === 1) {
        const err = Object.assign(
          new Error('duplicate key value violates unique constraint "idx_invoices_number"'),
          { code: '23505', constraint: 'idx_invoices_number' },
        );
        throw err;
      }
      return cb(tx);
    }),
  };

  return { state, db, tx };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  quotes: { id: 'quotes.id', tenantId: 'quotes.tenant_id', deletedAt: 'quotes.deleted_at' },
  quoteLineItems: { quoteId: 'quote_line_items.quote_id' },
  invoices: {
    id: 'invoices.id',
    tenantId: 'invoices.tenant_id',
    quoteId: 'invoices.quote_id',
    invoiceNumber: 'invoices.invoice_number',
    deletedAt: 'invoices.deleted_at',
  },
  invoiceLineItems: { id: 'invoice_line_items.id' },
  activities: { id: 'activities.id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...p: unknown[]) => ({ and: p })),
  isNull: vi.fn((a: unknown) => ({ isNull: a })),
  sql: vi.fn((s: unknown) => ({ sql: s })),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'member-1' })),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    apiError: vi.fn((err: unknown) =>
      NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
    ),
  };
});

import { POST } from '@/app/api/tenant/quotes/[id]/convert-to-invoice/route';

function convertRequest() {
  return new Request(`http://localhost:3000/api/tenant/quotes/${QUOTE_ID}/convert-to-invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }) as unknown as NextRequest;
}

async function call() {
  return POST(convertRequest(), { params: Promise.resolve({ id: QUOTE_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.txCalls = 0;
  m.state.invoiceLookupQueue = [];
  m.state.txMode = 'succeed';
});

describe('POST .../convert-to-invoice — quote→invoice race (#2228 / #2257)', () => {
  it('23505 on uq_invoices_quote_id answers 409 with the winner invoice id, not 500', async () => {
    m.state.txMode = 'quote23505';
    // pre-check finds nothing; the post-23505 lookup finds the winner
    m.state.invoiceLookupQueue = [null, { id: WINNER_INVOICE }];

    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String), invoiceId: WINNER_INVOICE });

    // The race-loser must NOT burn the invoice-number retry loop — every
    // retry would violate the same quote constraint.
    expect(m.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('23505 on uq_invoices_quote_id with no visible live winner still answers 409, never 500', async () => {
    m.state.txMode = 'quote23505';
    m.state.invoiceLookupQueue = [null, null];

    const res = await call();
    expect(res.status).toBe(409);
    expect(m.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('a 23505 whose constraint is wrapped only in the message is still recognized', async () => {
    m.state.txMode = 'quote23505';
    m.db.transaction.mockImplementationOnce(async () => {
      // node-postgres errors surface through drizzle with the raw error as
      // `cause` in some versions — message-only detection must still 409.
      throw Object.assign(new Error('duplicate key value violates unique constraint "uq_invoices_quote_id"'), {
        cause: { code: '23505', constraint: 'uq_invoices_quote_id' },
      });
    });
    m.state.invoiceLookupQueue = [null, { id: WINNER_INVOICE }];

    const res = await call();
    expect(res.status).toBe(409);
  });

  it('the invoice-number collision retry loop is untouched: 23505 on idx_invoices_number retries and succeeds', async () => {
    m.state.txMode = 'number23505-then-succeed';
    m.state.invoiceLookupQueue = [null];

    const res = await call();
    expect(res.status).toBe(200);
    expect(m.db.transaction).toHaveBeenCalledTimes(2);
  });

  it('the existing pre-check fast path (already converted) still returns 409 without entering the tx', async () => {
    m.state.invoiceLookupQueue = [{ id: WINNER_INVOICE }];

    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.invoiceId).toBe(WINNER_INVOICE);
    expect(m.db.transaction).not.toHaveBeenCalled();
  });
});
