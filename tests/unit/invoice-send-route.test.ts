/**
 * Tests for POST /api/tenant/invoices/[id]/send — issues #2227 and #3168.
 *
 * #2227: the endpoint used to flip `status:'sent'` + `sentAt` in a transaction
 * that committed BEFORE the email was attempted, then `console.warn`ed on
 * delivery failure and still answered `{ ok:true, status:'sent' }`. A provider
 * outage therefore permanently marked the invoice sent although the customer
 * never received it. The fix attempts the email first and only persists the
 * status on successful delivery; failures answer 502 and leave the row un-sent.
 * (Lesson from #2222: no SMTP inside the db.transaction either.)
 *
 * #3168: the persistence half was `UPDATE invoices SET status='sent' … WHERE
 * id = $1` — no status in the clause and no tenant either. `invoices.status` is
 * owned by the payment ledger (`recalculateInvoicePayments` derives it from the
 * `invoice_payments` rows), so re-emailing a paid invoice demoted it below its
 * own `amount_paid`, and re-emailing a cancelled or void one reopened a document
 * the ledger refuses to touch; meanwhile tenancy rested on a pre-read taken a
 * full SMTP round-trip earlier. The write now claims `INVOICE_SENDABLE_FROM` and
 * the tenant in the WHERE, and a zero-row result means the row moved under this
 * handler — so the committed status is re-read and reported.
 *
 * Both halves are asserted the way #3159 does it: the SQL the guarded write
 * renders (through `PgDialect`, no database) and what the handler does when that
 * write matches zero rows, which is the race itself and the only part a mocked
 * `db` can replay.
 *
 * Uses the thenable-db mock pattern from tests/unit/public-tickets.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const INVOICE_ID = 'b2222222-2222-4222-8222-222222222222';
const dialect = new PgDialect({} as never);

type Captured = {
  sql: string;
  params: unknown[];
  set: Record<string, unknown>;
};

const state: {
  invoice: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  /** `.returning()` rows for the guarded UPDATE — `[]` means the row moved. */
  claimRows: unknown[];
  /** What the status re-read after a lost claim returns. */
  freshStatus: { status: string }[];
  updates: Captured[];
  insertedActivities: { table: string; values: Record<string, unknown> }[];
  selectTables: string[];
  txCalls: number;
} = {
  invoice: null,
  contact: null,
  claimRows: [],
  freshStatus: [],
  updates: [],
  insertedActivities: [],
  selectTables: [],
  txCalls: 0,
};

const tx: Record<string, unknown> = {
  update: (table: unknown) => {
    // `.set()` runs before `.where()`, so both halves are collected and the
    // statement is recorded only once the handler consumes it — `.returning()`
    // (a guarded claim) or a bare `await` (an update whose result is ignored).
    let rec: Captured = { sql: '', params: [], set: {} };
    const commit = (): void => {
      void getTableName(table as never);
      state.updates.push(rec);
    };
    const node: Record<string, unknown> = {
      set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
      where: (pred: unknown) => {
        const rendered = dialect.sqlToQuery(pred as never);
        rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
        return node;
      },
      returning: () => {
        commit();
        return Promise.resolve(state.claimRows);
      },
      then: (resolve: (v: unknown) => unknown) => {
        commit();
        return Promise.resolve(state.claimRows).then(resolve);
      },
    };
    return node;
  },
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      state.insertedActivities.push({ table: getTableName(table as never), values });
      return Promise.resolve();
    },
  }),
  select: (fields: Record<string, unknown>) => {
    const table = (fields as { status?: { table?: unknown } })?.status?.table;
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'limit', 'orderBy']) {
      builder[method] = () => builder;
    }
    builder['then'] = (resolve: (v: unknown) => unknown) => {
      if (table) state.selectTables.push(getTableName(table as never));
      return Promise.resolve(state.freshStatus).then(resolve);
    };
    return builder;
  },
};

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      invoices: { findFirst: async () => state.invoice },
      contacts: { findFirst: async () => state.contact },
    },
    transaction: vi.fn(async (cb: (t: unknown) => unknown) => {
      state.txCalls += 1;
      return cb(tx);
    }),
  },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'member-1' })),
  requireCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    apiError: vi.fn((err: unknown) =>
      NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
    ),
  };
});

import { db } from '@/drizzle/db';
import { sendEmail } from '@/lib/email/service';
import { logAudit } from '@/lib/audit';
import { INVOICE_SENDABLE_FROM } from '@/lib/billing/payments';
import { POST } from '@/app/api/tenant/invoices/[id]/send/route';

function sendRequest(body: Record<string, unknown> = {}) {
  return new Request(`http://localhost:3000/api/tenant/invoices/${INVOICE_ID}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function call(body?: Record<string, unknown>) {
  return POST(sendRequest(body ?? { to_email: 'buyer@example.test' }), {
    params: Promise.resolve({ id: INVOICE_ID }),
  });
}

const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id: INVOICE_ID,
  tenantId: TENANT,
  contactId: 'c-1',
  title: 'September services',
  invoiceNumber: 'INV-0001',
  totalAmount: '250.00',
  status: 'draft',
  dueDate: null,
  ...over,
});

const delivered = (): void => {
  vi.mocked(sendEmail).mockResolvedValue({ success: true, provider: 'smtp', messageId: 'msg-1' });
};

const SENT_GUARD = /"invoices"\."status" in \(/i;

beforeEach(() => {
  vi.clearAllMocks();
  state.invoice = invoiceRow();
  state.contact = { firstName: 'Buyer', lastName: 'One', email: 'buyer@example.test' };
  state.claimRows = [{ id: INVOICE_ID }];
  state.freshStatus = [];
  state.updates = [];
  state.insertedActivities = [];
  state.selectTables = [];
  state.txCalls = 0;
});

describe('POST /api/tenant/invoices/[id]/send — honest send status (#2227)', () => {
  it('delivery failure (success:false) keeps the invoice un-sent and returns 502, not ok:true', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'SMTP provider down' });

    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).not.toBe('sent');
    expect(typeof body.error).toBe('string');

    // No status flip, no activity row, no transaction at all on failure
    expect(state.txCalls).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(state.insertedActivities).toHaveLength(0);

    // The failure is honestly audit-logged
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice_send_failed', entityId: INVOICE_ID }),
    );
  });

  it('delivery failure (sendEmail throws) also keeps the invoice un-sent and returns 502', async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error('connection refused'));

    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(state.insertedActivities).toHaveLength(0);
  });

  it('successful delivery marks status:sent + sentAt and answers ok:true', async () => {
    delivered();

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: 'sent', to_email: 'buyer@example.test' });
    expect(body.email.success).toBe(true);

    // Email was attempted BEFORE the status write (no SMTP inside the tx,
    // and the tx must reflect an already-successful delivery)
    expect(vi.mocked(sendEmail).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(db.transaction).mock.invocationCallOrder[0]!);

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.set).toMatchObject({ status: 'sent' });
    expect(state.updates[0]!.set.sentAt).toBeInstanceOf(Date);
    expect(state.insertedActivities).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice_sent' }));
  });

  it('resends are still honest: a failure after a previous successful send does not re-mark', async () => {
    state.invoice = invoiceRow(); // status stays 'draft' in the row we assert against
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'rate limited' });

    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.status).toBe('draft');
  });
});

describe('POST /api/tenant/invoices/[id]/send — guarded status write (#3168)', () => {
  it('the UPDATE names the from-set and the tenant, not just the id', async () => {
    delivered();
    await call();

    expect(state.updates).toHaveLength(1);
    const { sql, params } = state.updates[0]!;
    expect(sql).toMatch(SENT_GUARD);
    expect(sql).toMatch(/"invoices"\."tenant_id"/i);
    // id, tenant, and the single from-status a send may claim
    expect(params).toEqual([INVOICE_ID, TENANT, ...INVOICE_SENDABLE_FROM]);
  });

  it('the from-set is what the ledger leaves for the send event, and nothing else', () => {
    // `sent` is one of the ledger's PAYMENT_DRIVEN_STATUSES, so an email may
    // only ever issue a document that has not been issued: anything past draft
    // already carries a status derived from money.
    expect(INVOICE_SENDABLE_FROM).toEqual(['draft']);
  });

  it('a lost claim reports the committed status and re-reads it under the tenant', async () => {
    // The invoice was a draft at the pre-read; a payment landed during SMTP, so
    // the ledger owns `paid` now and this UPDATE matches nothing.
    state.claimRows = [];
    state.freshStatus = [{ status: 'paid' }];
    delivered();

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('paid');

    expect(state.updates).toHaveLength(1);
    expect(state.selectTables).toEqual(['invoices']);

    // the email really went out, so the timeline says so — and says what the
    // row ended up as, rather than implying this send issued it
    expect(state.insertedActivities).toHaveLength(1);
    const values = state.insertedActivities[0]!.values;
    expect(values.eventType).toBe('invoice_sent');
    expect((values.metadata as Record<string, unknown>).status_after_send).toBe('paid');

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoice_sent',
        newData: expect.objectContaining({ status: 'paid' }),
      }),
    );
  });

  it('a cancelled or void invoice is not reopened by a resend', async () => {
    for (const committed of ['cancelled', 'void'] as const) {
      state.updates = [];
      state.insertedActivities = [];
      state.claimRows = [];
      state.freshStatus = [{ status: committed }];
      delivered();

      const body = await (await call()).json();
      expect(body.status).toBe(committed);
    }
  });

  it('a second concurrent send does not restamp sentAt', async () => {
    // Both handlers pass the pre-read on a draft; the loser's guarded UPDATE
    // matches nothing once the winner has committed `sent`.
    state.claimRows = [];
    state.freshStatus = [{ status: 'sent' }];
    delivered();

    const body = await (await call()).json();
    expect(body.status).toBe('sent');
    expect(state.updates[0]!.params).toEqual([INVOICE_ID, TENANT, 'draft']);
  });

  it('the tenant guard survives the SMTP window', async () => {
    delivered();
    await call({ to_email: 'other@example.test' });
    // The pre-read is separated from the write by a full round-trip to the
    // provider, so it cannot be the only thing asserting the row's workspace.
    expect(state.updates[0]!.sql).toContain('"invoices"."tenant_id"');
  });
});
