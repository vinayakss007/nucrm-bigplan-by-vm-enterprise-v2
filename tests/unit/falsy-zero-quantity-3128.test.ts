/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for #3128 — two money paths still coerce a legal `quantity: 0` into one unit.
 *
 * `createInvoiceSchema` and the tax calculator's `LineItem` both allow a quantity
 * of zero (`z.coerce.number().min(0)` at `lib/api/schemas/billing.ts:63`), and #3109
 * proved what `|| 1` does with that: it reads "absent" out of a value that is
 * present and zero. Two sites kept the old default after that fix:
 *
 *  - `app/api/tenant/invoices/route.ts:192` persists `String(item.quantity || 1)`
 *    on the line row while computing that same line's money with `?? 1` at `:182`.
 *    A zero-quantity line therefore lands in `invoice_line_items` as one unit with
 *    `total = "0.00"` — a row whose own columns do not multiply out to its own
 *    total, which is exactly the reconciliation the `L-1` comment above it exists
 *    to protect.
 *  - `lib/tax.ts:230` computes `item.amount * (item.quantity || 1)` and feeds that
 *    into both the running subtotal and `calculateCompoundTax`. Reached from
 *    `POST /api/tenant/tax/calculate` (`app/api/tenant/tax/calculate/route.ts:51`),
 *    which passes request-body items straight through — so quoting tax on a
 *    zero-quantity line returns a real, wrong number.
 *
 * The invoice assertions run the REAL `validateBody` + `createInvoiceSchema` so the
 * `quantity: 0` that reaches the route is the value zod actually accepts, and read
 * the captured insert patches — no database (the dev DB has zero rows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { invoices, invoiceLineItems } from '@/drizzle/schema';

type Row = Record<string, unknown>;

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const CONTACT = 'b2222222-2222-4222-8222-222222222222';
const RATE_ID = 'c3333333-3333-4333-8333-333333333333';

const { state, db } = vi.hoisted(() => {
  const state = {
    inserts: [] as Array<{ table: unknown; rows: Row }>,
    updates: [] as Array<{ table: unknown; set: Row }>,
    maxNum: 4,
    /** What `db.query.taxRates.findFirst` answers — set per test. */
    taxRate: null as Row | null,
  };

  function chain(rows: () => unknown[], terminal: 'limit' | 'returning') {
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      innerJoin: () => self,
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows()).then(res),
    };
    self[terminal === 'limit' ? 'limit' : 'returning'] = () => Promise.resolve(rows());
    return self;
  }

  function insertable(id: string) {
    return (table: unknown) => ({
      values: (rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : [rows]) as Row[];
        state.inserts.push(...list.map(row => ({ table, rows: row })));
        return chain(() => [{ id, ...list[0] }], 'returning');
      },
    });
  }

  const tx = {
    execute: async () => undefined,
    select: () => chain(() => [{ maxNum: state.maxNum }], 'limit'),
    insert: insertable('row-in-tx'),
    update: (table: unknown) => ({
      set: (values: Row) => {
        state.updates.push({ table, set: values });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };

  return {
    state,
    db: {
      select: () => chain(() => [], 'limit'),
      insert: insertable('row-outside-tx'),
      update: (table: unknown) => ({
        set: (values: Row) => {
          state.updates.push({ table, set: values });
          return { where: () => Promise.resolve(undefined) };
        },
      }),
      query: {
        taxRates: {
          findFirst: vi.fn(async () => state.taxRate),
        },
      },
      transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  };
});

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'member-1', isSuperAdmin: false })),
  requirePerm: vi.fn(() => null),
  requireCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <H>(handler: H): H => handler }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

import { POST as postInvoice } from '@/app/api/tenant/invoices/route';

function lineRows(): Row[] {
  return state.inserts.filter(i => i.table === invoiceLineItems).map(i => i.rows);
}

async function postInvoiceRaw(items: unknown[]): Promise<Response> {
  state.inserts = [];
  state.updates = [];
  const req = new Request('http://localhost:3000/api/tenant/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contact_id: CONTACT,
      issue_date: '2026-10-20',
      due_date: '2026-11-20',
      line_items: items,
    }),
  }) as unknown as NextRequest;
  return postInvoice(req) as unknown as Response;
}

async function createInvoice(items: unknown[]): Promise<Row> {
  const res = await postInvoiceRaw(items);
  if (res.status !== 201) {
    throw new Error(`invoice POST answered ${res.status}: ${JSON.stringify(await res.json())}`);
  }
  const header = state.inserts.find(i => i.table === invoices)?.rows;
  if (!header) throw new Error('no invoice row was inserted');
  return header;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.inserts = [];
  state.updates = [];
  state.maxNum = 4;
  state.taxRate = { id: RATE_ID, name: 'GST', rate: '10', type: 'percentage', isActive: true };
});

describe('POST /api/tenant/invoices — a zero-quantity line is stored as zero (#3128)', () => {
  it('persists quantity 0 on the row instead of rewriting it to 1', async () => {
    await createInvoice([
      { description: 'Waived item', quantity: 0, unit_price: 50 },
      { description: 'Widget', quantity: 2, unit_price: 10 },
    ]);
    const rows = lineRows();
    expect(rows[0]?.quantity).toBe('0');
    expect(rows[1]?.quantity).toBe('2');
  });

  it('keeps the row internally consistent — the columns multiply out to its own total', async () => {
    await createInvoice([{ description: 'Waived item', quantity: 0, unit_price: 50 }]);
    const row = lineRows()[0];
    expect(row?.total).toBe('0.00');
    expect(Number(row?.quantity) * Number(row?.unitPrice)).toBe(0);
  });

  it('charges the header for nothing on a zero line, and still bills the rest', async () => {
    const header = await createInvoice([
      { description: 'Waived item', quantity: 0, unit_price: 50 },
      { description: 'Widget', quantity: 2, unit_price: 10 },
    ]);
    expect(header.subtotal).toBe('20.00');
    expect(header.totalAmount).toBe('20.00');
  });

  it('rejects a line with no quantity at all, so the ?? 1 default is only ever about 0', async () => {
    // createInvoiceSchema declares quantity as required (`z.coerce.number().min(0)`,
    // lib/api/schemas/billing.ts:63), so a missing key is a 400 rather than a
    // silent one-unit default. The `?? 1` this file exercises exists to keep the
    // zero that IS accepted from becoming a one.
    const res = await postInvoiceRaw([
      { description: 'No quantity', unit_price: 25 } as unknown,
    ]);
    expect(res.status).toBe(400);
  });

  it('stores a zero unit price as 0 on a zero-priced line', async () => {
    await createInvoice([{ description: 'Free item', quantity: 3, unit_price: 0 }]);
    const row = lineRows()[0];
    expect(row?.unitPrice).toBe('0');
    expect(row?.total).toBe('0.00');
    expect(row?.quantity).toBe('3');
  });

  it('still costs a whole-cent order the same way it did', async () => {
    const header = await createInvoice([
      { description: 'Seat', quantity: 10, unit_price: 120 },
      { description: 'Setup', quantity: 1, unit_price: 250 },
    ]);
    expect(header.subtotal).toBe('1450.00');
    expect(lineRows().map(r => r.quantity)).toEqual(['10', '1']);
  });
});

describe('applyTaxToLineItems — a zero-quantity line is not taxed as one unit (#3128)', () => {
  const config = { taxRateIds: [RATE_ID], tenantId: TENANT };

  it('subtotals a zero-quantity line at zero', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const out = await applyTaxToLineItems([{ amount: 50, quantity: 0 }], config);
    expect(out.summary.subtotal).toBe(0);
  });

  it('charges no tax on a zero-quantity line', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const out = await applyTaxToLineItems([{ amount: 50, quantity: 0 }], config);
    expect(out.summary.totalTax).toBe(0);
    expect(out.items[0]?.taxAmount).toBe(0);
    expect(out.items[0]?.totalWithTax).toBe(0);
  });

  it('still defaults an absent quantity to one unit', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const out = await applyTaxToLineItems([{ amount: 50 }], config);
    expect(out.summary.subtotal).toBe(50);
    expect(out.summary.totalTax).toBe(5);
  });

  it('costs a normal quantity unchanged', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const out = await applyTaxToLineItems([{ amount: 50, quantity: 3 }], config);
    expect(out.summary.subtotal).toBe(150);
    expect(out.summary.totalTax).toBe(15);
  });
});
