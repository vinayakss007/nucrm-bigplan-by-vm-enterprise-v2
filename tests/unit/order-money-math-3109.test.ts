/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for POST /api/tenant/orders — issue #3109.
 *
 * Two defects in the order-costing path:
 *
 *  1. The header was accumulated as raw IEEE-754 floats
 *     (`subtotal += qty * price` in a loop) and rounded ONCE at the end with
 *     `.toFixed(2)`, while every line's own stored `total` was rounded per
 *     line. The two therefore disagree whenever a line price carries a
 *     sub-cent fraction — which `createOrderSchema` allows, since it only
 *     declares `z.coerce.number().min(0)`. The order rows the API writes end up
 *     with a header that is not the sum of the lines it just inserted.
 *     `lib/money.ts` exists precisely to stop that (`sumLineItems` rounds at
 *     each accumulation step, `lineTotal` rounds the product), and the quotes
 *     and invoices routes already use it; orders was the one document type left
 *     on hand-rolled float math.
 *
 *  2. `parseFloat(String(item.quantity)) || 1` and `String(item.quantity || 1)`
 *     treat a legal `quantity: 0` as absent, so a zero-quantity line is billed
 *     as one unit AND persisted with `quantity = "1"`. The order header charges
 *     the customer for an item nobody ordered, and the stored line no longer
 *     describes the document that was created. `?? 1` keeps the "absent means
 *     one" default without swallowing the zero.
 *
 * Everything here is asserted against the captured insert patches, so none of
 * it needs a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

const m = vi.hoisted(() => {
  const state: { orders: Row[]; lines: Row[] } = { orders: [], lines: [] };

  const ordersTable = { __table: 'orders' };
  const linesTable = { __table: 'order_line_items' };

  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve([{ maxNum: 0 }]);
      return chain;
    }),
    insert: vi.fn((table: unknown) => {
      const isLines = table === linesTable;
      const chain: Record<string, unknown> = {};
      chain.values = (rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : [rows]) as Row[];
        if (isLines) {
          state.lines.push(...list);
          return Promise.resolve(undefined);
        }
        state.orders.push(...list);
        return {
          returning: async () => [{ id: 'ord-new', orderNumber: list[0]?.orderNumber }],
        };
      };
      return chain;
    }),
  };

  const db = {
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  return { state, db, tx, ordersTable, linesTable };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  orders: {
    ...m.ordersTable,
    tenantId: 'orders.tenant_id',
    orderNumber: 'orders.order_number',
    deletedAt: 'orders.deleted_at',
  },
  orderLineItems: m.linesTable,
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...p: unknown[]) => ({ and: p })),
  isNull: vi.fn((a: unknown) => ({ isNull: a })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
  count: vi.fn(() => ({ count: true })),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ strings, values })),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: 'a1111111-1111-4111-8111-111111111111', userId: 'member-1' })),
  requirePerm: vi.fn(() => undefined),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  validateBody: vi.fn((_schema: unknown, raw: unknown) => ({ data: raw })),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

import { POST } from '@/app/api/tenant/orders/route';

interface RawItem { description: string; quantity: number; unit_price: number }

async function createOrder(items: RawItem[]): Promise<{ order: Row; lines: Row[] }> {
  m.state.orders = [];
  m.state.lines = [];
  const req = new Request('http://localhost:3000/api/tenant/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ line_items: items }),
  }) as unknown as NextRequest;
  const res = await POST(req);
  expect(res.status).toBe(201);
  const order = m.state.orders.at(-1);
  if (!order) throw new Error('no order row was inserted');
  return { order, lines: m.state.lines };
}

/** Sum the cents the API persisted on the line rows. */
function linesTotal(lines: Row[]): number {
  return lines.reduce((sum, l) => sum + Math.round(parseFloat(String(l.total)) * 100), 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.orders = [];
  m.state.lines = [];
});

describe('POST /api/tenant/orders — header totals are rounded line sums, not float accumulation (#3109)', () => {
  it('a sub-cent unit price no longer makes the header disagree with its own lines', async () => {
    // 7 × 0.075 + 11 × 0.045 + 3 × 0.085. Each line rounds to 0.53 / 0.50 / 0.26
    // = 1.29. Raw accumulation gives 1.2749999999999998… → "1.27".
    const { order, lines } = await createOrder([
      { description: 'A', quantity: 7, unit_price: 0.075 },
      { description: 'B', quantity: 11, unit_price: 0.045 },
      { description: 'C', quantity: 3, unit_price: 0.085 },
    ]);
    expect(order.subtotal).toBe('1.29');
    expect(order.totalAmount).toBe('1.29');
    expect(linesTotal(lines)).toBe(129);
  });

  it('three half-cent lines bill three cents, not one', async () => {
    // Naive: 0.015 → "0.01" while each stored line reads 0.01.
    const { order, lines } = await createOrder([
      { description: 'Fee', quantity: 1, unit_price: 0.005 },
      { description: 'Fee', quantity: 1, unit_price: 0.005 },
      { description: 'Fee', quantity: 1, unit_price: 0.005 },
    ]);
    expect(lines.map(l => l.total)).toEqual(['0.01', '0.01', '0.01']);
    expect(order.subtotal).toBe('0.03');
    expect(order.totalAmount).toBe('0.03');
  });

  it('drift does not compound over a longer order', async () => {
    // 8 × 1.005: naive accumulation lands on 8.04 after one final rounding.
    const { order, lines } = await createOrder(
      Array.from({ length: 8 }, (_, i) => ({ description: `L${i}`, quantity: 1, unit_price: 1.005 })),
    );
    expect(order.subtotal).toBe('8.08');
    expect(order.totalAmount).toBe('8.08');
    expect(linesTotal(lines)).toBe(808);
  });

  it('subtotal and totalAmount are the same rounded number, both derived once', async () => {
    const { order } = await createOrder([{ description: 'Widget', quantity: 3, unit_price: 19.99 }]);
    expect(order.subtotal).toBe('59.97');
    expect(order.totalAmount).toBe('59.97');
  });

  it('rounds a line the way lib/money.ts does, so quotes/invoices/orders agree', async () => {
    const { lineTotal } = await import('@/lib/money');
    const { lines } = await createOrder([{ description: 'Metered', quantity: 3, unit_price: 0.1 }]);
    expect(lines[0]?.total).toBe(lineTotal(3, 0.1).toFixed(2));
  });
});

describe('POST /api/tenant/orders — a zero quantity is a zero quantity (#3109)', () => {
  it('does not bill a zero-quantity line as one unit', async () => {
    const { order } = await createOrder([
      { description: 'Cancelled item', quantity: 0, unit_price: 50 },
      { description: 'Widget', quantity: 2, unit_price: 10 },
    ]);
    expect(order.subtotal).toBe('20.00');
    expect(order.totalAmount).toBe('20.00');
  });

  it('persists the zero on the line instead of rewriting it to 1', async () => {
    const { lines } = await createOrder([
      { description: 'Cancelled item', quantity: 0, unit_price: 50 },
      { description: 'Widget', quantity: 2, unit_price: 10 },
    ]);
    expect(lines[0]?.quantity).toBe('0');
    expect(lines[0]?.unitPrice).toBe('50');
    expect(lines[0]?.total).toBe('0.00');
    expect(lines[1]?.quantity).toBe('2');
    expect(lines[1]?.total).toBe('20.00');
  });

  it('still defaults an absent quantity to one', async () => {
    const { order, lines } = await createOrder([
      { description: 'Widget', quantity: undefined as unknown as number, unit_price: 25 },
    ]);
    expect(lines[0]?.quantity).toBe('1');
    expect(order.subtotal).toBe('25.00');
  });

  it('accepts quantity 0 at the boundary the route validates against', async () => {
    // Pins the contract the `|| 1` fallback violates: createOrderSchema allows 0.
    const { createOrderSchema } = await import('@/lib/api/schemas');
    const parsed = createOrderSchema.safeParse({
      line_items: [{ description: 'Zero', quantity: 0, unit_price: 50 }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('POST /api/tenant/orders — clean integer orders are unchanged (#3109)', () => {
  it('costs a whole-cent order exactly as it did before', async () => {
    const { order, lines } = await createOrder([
      { description: 'Widget', quantity: 2, unit_price: 50 },
      { description: 'Gizmo', quantity: 1, unit_price: 125.5 },
    ]);
    expect(order.subtotal).toBe('225.50');
    expect(order.totalAmount).toBe('225.50');
    expect(lines.map(l => l.total)).toEqual(['100.00', '125.50']);
    expect(lines.map(l => l.quantity)).toEqual(['2', '1']);
  });
});
