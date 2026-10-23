/**
 * #3128 — the invoice POST computed its money with the null-coalesce default
 * (`lineTotal(item.quantity ?? 1, …)`) but persisted the line identifiers with
 * `item.quantity || 1`, so a schema-legal `quantity: 0` row went in saying ONE
 * unit at full price while its own `total` column said `0.00`. The L-1 comment
 * two lines below exists so that line sums reconcile with the header, and a row
 * that cannot be recomputed from its own columns is where that breaks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const h = vi.hoisted(() => ({
  lineInserts: [] as Array<Array<Record<string, unknown>>>,
  invoiceInserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({ tenantId: TENANT, userId: 'u-1' }),
  requireCsrf: () => null,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));

vi.mock('@/drizzle/db', async () => {
  const { invoices, invoiceLineItems } = await import('@/drizzle/schema');
  const tx = {
    execute: async () => undefined,
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ maxNum: 4 }]) }) }),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        if (table === invoices) {
          const row = v as Record<string, unknown>;
          h.invoiceInserts.push(row);
          return { returning: async () => [{ id: 'inv-1', ...row }] };
        }
        if (table === invoiceLineItems) {
          h.lineInserts.push(v as Array<Record<string, unknown>>);
        }
        return Promise.resolve();
      },
    }),
  };
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  };
  return { db };
});

import { POST } from '@/app/api/tenant/invoices/route';

function post(body: unknown) {
  return new Request('http://localhost.test/api/tenant/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  h.lineInserts = [];
  h.invoiceInserts = [];
});

describe('POST /api/tenant/invoices — a zero quantity stays zero on the row (#3128)', () => {
  it('persists quantity 0 with total 0.00 instead of one unit at 50', async () => {
    const res = await POST(post({
      issue_date: '2026-01-05',
      line_items: [
        { description: 'free gift', quantity: 0, unit_price: 50 },
        { description: 'paid line', quantity: 2, unit_price: 10 },
      ],
    }));

    expect(res.status).toBe(201);
    const [lines] = h.lineInserts;
    const gift = lines!.find((l) => l.description === 'free gift')!;
    expect(gift.quantity, '`|| 1` rewrote a legal 0 into one billed unit').toBe('0');
    expect(gift.unitPrice).toBe('50');
    expect(gift.total).toBe('0.00');

    // The row is now recomputable: quantity × unit_price === total.
    expect(Number(gift.quantity) * Number(gift.unitPrice)).toBe(Number(gift.total));
    expect(lines!.find((l) => l.description === 'paid line')!.quantity).toBe('2');

    const header = h.invoiceInserts[0]!;
    expect(header.subtotal).toBe('20.00');
    expect(header.totalAmount).toBe('20.00');
  });

  it('bills a blank quantity as the 0 it coerces to, not as one unit', async () => {
    const res = await POST(post({
      issue_date: '2026-01-05',
      // quantity is required by createInvoiceSchema, but z.coerce turns the
      // blank text input the UI can post into 0 — which must bill as 0, not 1.
      line_items: [{ description: 'blank qty', quantity: '', unit_price: 7 }],
    }));

    expect(res.status).toBe(201);
    const [lines] = h.lineInserts;
    expect(lines![0]!.quantity).toBe('0');
    expect(lines![0]!.total).toBe('0.00');
    expect(h.invoiceInserts[0]!.subtotal).toBe('0.00');
  });
});
