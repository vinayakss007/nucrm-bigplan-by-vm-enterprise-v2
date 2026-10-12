/**
 * Tests for POST /api/tenant/invoices/[id]/send — issue #2227.
 *
 * The endpoint used to flip `status:'sent'` + `sentAt` in a transaction that
 * committed BEFORE the email was attempted, then `console.warn`ed on delivery
 * failure and still answered `{ ok:true, status:'sent' }`. A provider outage
 * therefore permanently marked the invoice sent although the customer never
 * received it. The fix attempts the email first and only persists the status
 * on successful delivery; failures answer 502 and leave the row un-sent.
 * (Lesson from #2222: no SMTP inside the db.transaction either.)
 *
 * Uses the thenable-db mock pattern from tests/unit/public-tickets.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const INVOICE_ID = 'b2222222-2222-4222-8222-222222222222';

const m = vi.hoisted(() => {
  const state = {
    invoice: null as Record<string, unknown> | null,
    contact: null as Record<string, unknown> | null,
    updateSets: [] as Record<string, unknown>[],
    insertedActivities: [] as unknown[],
    txCalls: 0,
  };

  const tx = {
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        state.updateSets.push(payload);
        return { where: vi.fn(async () => undefined) };
      },
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: unknown) => {
        state.insertedActivities.push(values);
      }),
    })),
  };

  const db = {
    query: {
      invoices: { findFirst: vi.fn(async () => state.invoice) },
      contacts: { findFirst: vi.fn(async () => state.contact) },
    },
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => {
      state.txCalls += 1;
      return cb(tx);
    }),
  };

  return { state, db, tx };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  invoices: { id: 'invoices.id', tenantId: 'invoices.tenant_id', status: 'invoices.status', deletedAt: 'invoices.deleted_at', updatedAt: 'invoices.updated_at' },
  contacts: { id: 'contacts.id' },
  activities: { id: 'activities.id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...p: unknown[]) => ({ and: p })),
  isNull: vi.fn((a: unknown) => ({ isNull: a })),
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
vi.mock('@/lib/sanitize', () => ({
  sanitizeHTMLServer: vi.fn((s: string) => s),
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

import { sendEmail } from '@/lib/email/service';
import { logAudit } from '@/lib/audit';
import { POST } from '@/app/api/tenant/invoices/[id]/send/route';

function sendRequest(body: Record<string, unknown> = {}) {
  return new Request(`http://localhost:3000/api/tenant/invoices/${INVOICE_ID}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function call(body?: Record<string, unknown>) {
  return POST(sendRequest(body ?? { to_email: 'buyer@example.com' }), {
    params: Promise.resolve({ id: INVOICE_ID }),
  });
}

const invoiceRow = () => ({
  id: INVOICE_ID,
  tenantId: TENANT,
  contactId: 'c-1',
  title: 'September services',
  invoiceNumber: 'INV-0001',
  totalAmount: '250.00',
  status: 'draft',
  dueDate: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.state.invoice = invoiceRow();
  m.state.contact = { firstName: 'Buyer', lastName: 'One', email: 'buyer@example.com' };
  m.state.updateSets = [];
  m.state.insertedActivities = [];
  m.state.txCalls = 0;
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
    expect(m.db.transaction).not.toHaveBeenCalled();
    expect(m.state.txCalls).toBe(0);
    expect(m.state.updateSets).toHaveLength(0);
    expect(m.state.insertedActivities).toHaveLength(0);

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
    expect(m.state.updateSets).toHaveLength(0);
    expect(m.state.insertedActivities).toHaveLength(0);
  });

  it('successful delivery marks status:sent + sentAt and answers ok:true', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true, provider: 'smtp', messageId: 'msg-1' });

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: 'sent', to_email: 'buyer@example.com' });
    expect(body.email.success).toBe(true);

    // Email was attempted BEFORE the status write (no SMTP inside the tx,
    // and the tx must reflect an already-successful delivery)
    expect(vi.mocked(sendEmail).mock.invocationCallOrder[0])
      .toBeLessThan(m.db.transaction.mock.invocationCallOrder[0]);

    expect(m.state.updateSets).toHaveLength(1);
    expect(m.state.updateSets[0]).toMatchObject({ status: 'sent' });
    expect(m.state.updateSets[0]!.sentAt).toBeInstanceOf(Date);
    expect(m.state.insertedActivities).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice_sent' }));
  });

  it('resends are still honest: a failure after a previous successful send does not re-mark', async () => {
    m.state.invoice = invoiceRow(); // status stays 'draft' in the row we assert against
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'rate limited' });

    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.status).toBe('draft');
  });
});
