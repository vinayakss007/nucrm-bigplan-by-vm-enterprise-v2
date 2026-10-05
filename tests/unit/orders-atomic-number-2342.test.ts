/**
 * Tests for POST /api/tenant/orders — issue #2342.
 *
 * The old implementation generated order numbers with COUNT(*)+1 read OUTSIDE
 * any lock: two concurrent POSTs computed the same ORD-##### and the loser hit
 * the unique idx_orders_number (tenant_id, order_number) and got a 500. The fix
 * mirrors the quote (#1611) and invoice (#1462) pattern: take a FOR UPDATE lock
 * on the tenant row inside the transaction, derive MAX(sequence)+1 from the
 * existing ORD-<digits> numbers, and retry up to 3 times on a 23505.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const m = vi.hoisted(() => {
  const state = {
    txCalls: 0,
    maxNum: 42,
    // 'succeed' → insert returns a row; '23505-always' → every attempt throws
    // a unique violation; '23505-then-succeed' → first throws, rest succeed.
    txMode: 'succeed' as 'succeed' | '23505-always' | '23505-then-succeed',
    insertedOrders: [] as Array<Record<string, unknown>>,
    executeSql: [] as unknown[],
  };

  const tx = {
    execute: vi.fn(async (frag: unknown) => {
      state.executeSql.push(frag);
      return undefined;
    }),
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve([{ maxNum: state.maxNum }]);
      return chain;
    }),
    insert: vi.fn((table: unknown) => {
      const isLineItems = table === m.lineItemsTable;
      const chain: Record<string, unknown> = {};
      chain.values = (rows: unknown) => {
        if (isLineItems) return Promise.resolve(undefined);
        state.insertedOrders.push(...(Array.isArray(rows) ? rows : [rows]) as Array<Record<string, unknown>>);
        return {
          returning: async () => {
            if (state.txMode === '23505-always' || (state.txMode === '23505-then-succeed' && state.txCalls === 1)) {
              throw Object.assign(
                new Error('duplicate key value violates unique constraint "idx_orders_number"'),
                { code: '23505', constraint: 'idx_orders_number' },
              );
            }
            const orderNumber = (state.insertedOrders.at(-1)?.orderNumber as string | undefined) ?? 'ORD-00001';
            return [{ id: 'ord-new', orderNumber }];
          },
        };
      };
      return chain;
    }),
  };

  const ordersTable = { __table: 'orders' };
  const lineItemsTable = { __table: 'order_line_items' };

  const db = {
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => {
      state.txCalls += 1;
      return cb(tx);
    }),
  };

  return { state, db, tx, ordersTable, lineItemsTable };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  orders: {
    ...m.ordersTable,
    tenantId: 'orders.tenant_id',
    orderNumber: 'orders.order_number',
    deletedAt: 'orders.deleted_at',
  },
  orderLineItems: m.lineItemsTable,
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
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'member-1' })),
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

function orderRequest() {
  return new Request('http://localhost:3000/api/tenant/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      line_items: [{ description: 'Widget', quantity: 2, unit_price: 50 }],
    }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.txCalls = 0;
  m.state.maxNum = 42;
  m.state.txMode = 'succeed';
  m.state.insertedOrders = [];
  m.state.executeSql = [];
});

describe('POST /api/tenant/orders — atomic order numbers (#2342)', () => {
  it('locks the tenant row FOR UPDATE inside the transaction before generating', async () => {
    const res = await POST(orderRequest());
    expect(res.status).toBe(201);
    expect(m.db.transaction).toHaveBeenCalledTimes(1);
    expect(m.tx.execute).toHaveBeenCalledTimes(1);
    const frag = m.state.executeSql[0] as { strings?: readonly string[] };
    const text = Array.isArray(frag?.strings) ? frag.strings.join('') : JSON.stringify(frag);
    expect(text).toContain('FOR UPDATE');
    expect(text).toContain('tenants');
  });

  it('derives the next number from MAX(sequence)+1, not COUNT(*)', async () => {
    m.state.maxNum = 7;
    const res = await POST(orderRequest());
    expect(res.status).toBe(201);
    // tx.select (the MAX derivation) ran inside the transaction; the old
    // implementation's top-level db.select COUNT query is gone entirely.
    expect(m.tx.select).toHaveBeenCalledTimes(1);
    expect(m.state.insertedOrders[0]?.orderNumber).toBe('ORD-00008');
  });

  it('pads the sequence to 5 digits', async () => {
    m.state.maxNum = 9999;
    await POST(orderRequest());
    expect(m.state.insertedOrders[0]?.orderNumber).toBe('ORD-10000');
  });

  it('retries on a 23505 against idx_orders_number and succeeds on attempt 2', async () => {
    m.state.txMode = '23505-then-succeed';
    const res = await POST(orderRequest());
    expect(res.status).toBe(201);
    expect(m.db.transaction).toHaveBeenCalledTimes(2);
    // the retry regenerated from MAX again (still 42 in the mock → ORD-00043)
    expect(m.state.insertedOrders.at(-1)?.orderNumber).toBe('ORD-00043');
  });

  it('gives up after 3 attempts and answers 500 when the violation persists', async () => {
    m.state.txMode = '23505-always';
    const res = await POST(orderRequest());
    expect(res.status).toBe(500);
    expect(m.db.transaction).toHaveBeenCalledTimes(3);
  });

  it('does NOT wrap generation in a top-level COUNT select outside the lock', async () => {
    // The pre-fix bug: a db.select COUNT query executed before the transaction.
    // There is no db.select at all on the mocked db now — everything is tx-scoped.
    const res = await POST(orderRequest());
    expect(res.status).toBe(201);
    expect((m.db as unknown as { select?: unknown }).select).toBeUndefined();
  });
});
