/**
 * #3109 — order totals accumulated in raw float, and quantity 0 silently billed
 * as one unit.
 *
 * `app/api/tenant/orders/route.ts` summed line items with
 * `subtotal += (parseFloat(...) || 1) * (parseFloat(...) || 0)` — IEEE-754 error
 * accumulating across lines, rounded once at the header — while every line's own
 * `total` was rounded at write, so the header could end up a cent away from the
 * sum of its lines. Worse, `|| 1` turned the schema-legal `quantity: 0`
 * (`createOrderSchema`: `z.coerce.number().min(0)`) into ONE BILLED UNIT, in both
 * the line and the header. `lib/money.ts` exists precisely for this and the
 * invoices/quotes routes already use it; orders were left behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const h = vi.hoisted(() => ({
  orderInserts: [] as Array<Record<string, unknown>>,
  lineInserts: [] as Array<Array<Record<string, unknown>>>,
}));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({ tenantId: TENANT, userId: 'u-1' }),
  requirePerm: () => null,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));

vi.mock('@/drizzle/db', async () => {
  const { orders, orderLineItems } = await import('@/drizzle/schema');
  const withReturning = <T,>(rows: T[]) => Object.assign(Promise.resolve(), { returning: async () => rows });
  const tx = {
    execute: async () => undefined,
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ maxNum: 4 }]) }) }),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        const rows = (Array.isArray(v) ? v : [v]) as Array<Record<string, unknown>>;
        if (table === orders) { h.orderInserts.push(...rows); return withReturning([{ id: 'o-1', orderNumber: 'ORD-00005' }]); }
        if (table === orderLineItems) { h.lineInserts.push(rows); return Promise.resolve(); }
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

function post(body: unknown) {
  return new Request('http://localhost/api/tenant/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.orderInserts = [];
  h.lineInserts = [];
});

describe('#3109 order money math uses lib/money and keeps quantity 0 legal', () => {
  it('a quantity-0 line contributes 0 to the line total AND the header subtotal', async () => {
    const { POST } = await import('@/app/api/tenant/orders/route');
    const res = await POST(post({
      title: 'Memo order',
      line_items: [
        { description: 'paid line', quantity: 1, unit_price: 10 },
        { description: 'free gift', quantity: 0, unit_price: 50 },
      ],
    }));
    expect(res.status).toBe(201);
    const [lines] = h.lineInserts;
    const gift = lines!.find((l) => l.description === 'free gift')!;
    expect(gift.quantity, '|| 1 turned a legal 0 into one billed unit').toBe('0');
    expect(gift.total).toBe('0.00');
    const order = h.orderInserts[0]!;
    expect(order.subtotal).toBe('10.00');
    expect(order.totalAmount).toBe('10.00');
  });

  it('header subtotal equals the sum of the per-line totals — no float drift', async () => {
    // 3 × 0.005: each line rounds to 0.01 at write (sum 0.03), while the raw
    // float subtotal 0.015000000000000001 toFixed(2)s to "0.02".
    const { POST } = await import('@/app/api/tenant/orders/route');
    const res = await POST(post({
      line_items: [1, 2, 3].map((n) => ({ description: `half-cent ${n}`, quantity: 1, unit_price: 0.005 })),
    }));
    expect(res.status).toBe(201);
    const [lines] = h.lineInserts;
    const lineSum = lines!.reduce((acc, l) => acc + Number(l.total), 0);
    const order = h.orderInserts[0]!;
    expect(Number(order.subtotal), `header ${String(order.subtotal)} must equal Σ line totals ${lineSum.toFixed(2)}`).toBeCloseTo(0.03, 10);
    expect(Number(order.totalAmount)).toBeCloseTo(0.03, 10);
  });

  it('an empty-string quantity coerces to the legal 0 — and is billed as 0, not 1', async () => {
    // A blank text input posts `quantity: ''`; z.coerce turns it into 0, which
    // min(0) accepts. `|| 1` silently billed one unit of unit_price on such a line.
    const { POST } = await import('@/app/api/tenant/orders/route');
    const res = await POST(post({
      line_items: [{ description: 'blank qty', quantity: '', unit_price: 7 }],
    }));
    expect(res.status).toBe(201);
    expect(h.lineInserts[0]![0]!.total).toBe('0.00');
    expect(h.orderInserts[0]!.subtotal).toBe('0.00');
  });
});
