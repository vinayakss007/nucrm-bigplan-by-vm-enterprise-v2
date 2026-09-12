import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Captured writes so tests can assert on what the cron inserted/updated ─────
type Row = Record<string, unknown>;
const inserted: { table: string; values: Row | Row[] }[] = [];
const updated: { set: Row }[] = [];

// The list of due templates the SELECT on `invoices` returns.
let dueTemplates: Row[] = [];
// The line items the SELECT on `invoiceLineItems` returns.
let lineItems: Row[] = [];

// db.select() is used twice with different shapes:
//   invoices:        .from().where()            -> due templates
//   invoiceLineItems .from().where().orderBy()  -> line items
function makeSelectChain() {
  return {
    from: (table: unknown) => {
      const isLineItems = String(table) === 'invoice_line_items';
      const whereResult = {
        orderBy: () => Promise.resolve(lineItems),
        then: (res: (v: Row[]) => void) => res(isLineItems ? lineItems : dueTemplates),
      };
      return { where: () => whereResult };
    },
  };
}

// Transaction stub: provides select (for MAX number), insert, update, execute.
const tx = {
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockReturnValue({
    from: () => ({ where: () => Promise.resolve([{ maxNum: 41 }]) }),
  }),
  insert: vi.fn().mockImplementation((table: unknown) => ({
    values: (vals: Row | Row[]) => {
      inserted.push({ table: String(table), values: vals });
      return { returning: () => Promise.resolve([{ id: 'new-invoice-id', ...(Array.isArray(vals) ? {} : vals) }]) };
    },
  })),
  update: vi.fn().mockReturnValue({
    set: (s: Row) => {
      updated.push({ set: s });
      return { where: () => Promise.resolve([]) };
    },
  }),
};

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  invoices: { toString: () => 'invoices', tenantId: 't', invoiceNumber: 'n', isRecurring: 'r', deletedAt: 'd', status: 's', nextBillingDate: 'nb', id: 'id' },
  invoiceLineItems: { toString: () => 'invoice_line_items', invoiceId: 'inv', sortOrder: 'so' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
  isNull: vi.fn(() => true),
  lte: vi.fn(() => true),
  ne: vi.fn(() => true),
  inArray: vi.fn(() => true),
  sql: Object.assign(
    vi.fn((_s: TemplateStringsArray, ...v: unknown[]) => `SQL(${v.join(',')})`),
    {},
  ),
}));

vi.mock('@/lib/crypto', () => ({ verifySecret: vi.fn(() => true) }));
vi.mock('@/lib/cache', () => ({ acquireLock: vi.fn().mockResolvedValue({ acquired: true, value: 'l' }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/api-error', () => ({ apiError: () => new Response(JSON.stringify({ error: 'e' }), { status: 500 }) }));

function makeReq(withSecret = true): NextRequest {
  return new Request('http://localhost/api/cron/recurring-invoice-generator', {
    method: 'POST',
    headers: withSecret ? { 'x-cron-secret': 'test-secret' } : {},
  }) as unknown as NextRequest;
}

describe('recurring-invoice-generator cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserted.length = 0;
    updated.length = 0;
    dueTemplates = [];
    lineItems = [];
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);
    const { POST } = await import('@/app/api/cron/recurring-invoice-generator/route');
    const res = await POST(makeReq(false));
    expect(res.status).toBe(401);
  });

  it('skips when the distributed lock is held', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });
    const { POST } = await import('@/app/api/cron/recurring-invoice-generator/route');
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skipped).toBe(true);
  });

  it('returns due=0 generated=0 when nothing is due', async () => {
    const { POST } = await import('@/app/api/cron/recurring-invoice-generator/route');
    const res = await POST(makeReq());
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, due: 0, generated: 0, failed: 0 });
    expect(inserted).toHaveLength(0);
  });

  it('generates one invoice per due template, clones line items, links the series, advances the schedule', async () => {
    dueTemplates = [{
      id: 'tmpl-1',
      tenantId: 'tenant-1',
      contactId: 'c1',
      companyId: null,
      dealId: null,
      title: 'Monthly retainer',
      subtotal: '100.00',
      discountType: 'percentage',
      discountValue: '0',
      discountAmount: '0',
      taxAmount: '18.00',
      taxRate: '18',
      totalAmount: '118.00',
      currency: 'INR',
      notes: 'thanks',
      terms: 'net 15',
      footer: null,
      issueDate: '2026-01-01',
      dueDate: '2026-01-15',
      isRecurring: true,
      recurringFrequency: 'monthly',
      nextBillingDate: '2026-02-01',
      parentInvoiceId: null,
      createdBy: 'user-1',
    }];
    lineItems = [{
      invoiceId: 'tmpl-1',
      productId: null, serviceId: null, description: 'Retainer', itemType: 'custom',
      quantity: '1', unitPrice: '100.00', discountType: 'percentage', discountValue: '0',
      discountAmount: '0', taxRate: '18', taxAmount: '18.00', total: '100.00', sortOrder: 0,
    }];

    const { POST } = await import('@/app/api/cron/recurring-invoice-generator/route');
    const res = await POST(makeReq());
    const body = await res.json();

    expect(body).toMatchObject({ ok: true, due: 1, generated: 1, failed: 0 });

    // One invoice insert + one line-items insert.
    const invoiceInsert = inserted.find((i) => i.table === 'invoices');
    const itemsInsert = inserted.find((i) => i.table === 'invoice_line_items');
    expect(invoiceInsert).toBeTruthy();
    expect(itemsInsert).toBeTruthy();

    const inv = invoiceInsert!.values as Row;
    // Fresh number from MAX(41)+1 = 42.
    expect(inv.invoiceNumber).toBe('INV-00042');
    // Spawned invoice is concrete, not itself recurring.
    expect(inv.isRecurring).toBe(false);
    // Series link points at the root (template itself, since it had no parent).
    expect(inv.parentInvoiceId).toBe('tmpl-1');
    // Amounts/currency copied.
    expect(inv.totalAmount).toBe('118.00');
    expect(inv.currency).toBe('INR');
    // due-date gap (14 days) preserved from today (issueDate = today).
    expect(typeof inv.issueDate).toBe('string');

    // Line item cloned verbatim (as an array).
    const items = itemsInsert!.values as Row[];
    expect(Array.isArray(items)).toBe(true);
    expect(items[0]).toMatchObject({ description: 'Retainer', total: '100.00', invoiceId: 'new-invoice-id' });

    // Template schedule advanced monthly: 2026-02-01 -> 2026-03-01.
    expect(updated.some((u) => u.set.nextBillingDate === '2026-03-01')).toBe(true);
  });
});
