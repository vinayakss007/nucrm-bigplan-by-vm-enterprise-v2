/**
 * #3109 — orders/POST accumulated line totals in raw IEEE-754 floats (rounded
 * once at the end) and used `quantity || 1`, which promoted a schema-legal
 * quantity of 0 to one billed unit. The route must now delegate to
 * lib/money: sumLineItems for the header, lineTotal per line, `?? 1` so 0
 * stays 0. These run the REAL validateBody + the REAL money helpers so a
 * future edit cannot re-introduce the bespoke math unnoticed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const H = vi.hoisted(() => ({
  orderRows: [] as Record<string, unknown>[],
  lineRows: [] as Record<string, unknown>[],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        execute: async () => undefined,
        select: () => ({ from: () => ({ where: async () => [{ maxNum: 0 }] }) }),
        insert: (table: { [Symbol.for('drizzle:Name')]?: string }) => ({
          values: (rows: unknown) => {
            const name = table[Symbol.for('drizzle:Name')] ?? '';
            if (name === 'order_line_items') H.lineRows.push(...(rows as Record<string, unknown>[]));
            if (name === 'orders') H.orderRows.push(rows as Record<string, unknown>);
            const p = Promise.resolve([{ id: 'o-1' }]);
            return { returning: () => p };
          },
        }),
      }),
  },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: 'tenant-1', userId: 'user-1', isSuperAdmin: false }),
  requireModule: () => null,
  // The route calls requirePerm WITHOUT await — a Promise-returning mock would
  // be truthy and short-circuit the handler with a bare `return deny`.
  requirePerm: () => null,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T) => h }));

import { POST } from '@/app/api/tenant/orders/route';
import { sumLineItems, lineTotal } from '@/lib/money';

beforeEach(() => {
  H.orderRows = [];
  H.lineRows = [];
});

function postOrder(body: unknown) {
  const req = new Request('http://localhost/api/tenant/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return POST(req);
}

describe('#3109 orders/POST uses lib/money and keeps quantity 0 legal', () => {
  it('a zero-quantity line contributes 0 to both line total and subtotal', async () => {
    const items = [
      { description: 'Free sample', quantity: 0, unit_price: 50 },
      { description: 'Paid line', quantity: 2, unit_price: 25 },
    ];
    const res = await postOrder({ title: 'Mixed order', line_items: items });
    expect(res.status).toBe(201);

    expect(H.lineRows).toHaveLength(2);
    expect(H.lineRows[0].quantity).toBe('0');
    expect(H.lineRows[0].total).toBe('0.00');
    expect(H.lineRows[1].total).toBe('50.00');
    expect(H.orderRows[0].subtotal).toBe('50.00');
    expect(H.orderRows[0].totalAmount).toBe('50.00');
  });

  it('header subtotal equals the cent-rounded sumLineItems value and the sum of line totals', async () => {
    const items = [
      { description: 'a', quantity: 3, unit_price: 0.1 },
      { description: 'b', quantity: 1, unit_price: 0.2 },
      { description: 'c', quantity: 7, unit_price: 1.005 },
      { description: 'd', quantity: 11, unit_price: 0.07 },
    ];
    const res = await postOrder({ title: 'Drift order', line_items: items });
    expect(res.status).toBe(201);

    // Each persisted line total is exactly lineTotal(...) — not bespoke math.
    for (let i = 0; i < items.length; i++) {
      expect(H.lineRows[i].total).toBe(lineTotal(items[i].quantity, items[i].unit_price).toFixed(2));
    }
    // Header subtotal is sumLineItems over the same items...
    const expected = sumLineItems(items).toFixed(2);
    expect(H.orderRows[0].subtotal).toBe(expected);
    // ...and reconciles with the sum of the per-line totals it wrote.
    const lineSum = H.lineRows
      .reduce((acc, r) => acc + Math.round(Number(r.total) * 100), 0) / 100;
    expect(Number(H.orderRows[0].subtotal)).toBeCloseTo(lineSum, 10);
    expect(H.orderRows[0].totalAmount).toBe(expected);
  });

  it('the route no longer carries bespoke float/||1 money math', async () => {
    const fs = await import('fs');
    const code = fs.readFileSync('app/api/tenant/orders/route.ts', 'utf-8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/parseFloat\(String\(item\.quantity\)\)/);
    expect(code).not.toMatch(/item\.quantity \|\| 1/);
    expect(code).toMatch(/sumLineItems\(items\)/);
    expect(code).toMatch(/lineTotal\(/);
  });
});
