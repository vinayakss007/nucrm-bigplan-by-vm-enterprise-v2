/**
 * #3108 — the quote route persisted per-line tax from `item.tax_amount`, a key
 * `createQuoteSchema` never declares (the line field is `tax_rate`) and which
 * `schema.parse` strips. Every quote line was therefore written with
 * `tax_percent = '0'` for every client; convert-to-invoice then copied the '0'
 * and hard-coded `taxAmount: '0'`. These tests run the REAL validateBody
 * end-to-end so the stripped-key class of bug can never re-hide behind a
 * mocked validator (the blind spot that let this ship).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const H = vi.hoisted(() => ({
  lineRows: [] as Record<string, unknown>[],
  invoiceLineRows: [] as Record<string, unknown>[],
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
            if (name === 'quote_line_items') H.lineRows.push(...(rows as Record<string, unknown>[]));
            const p = Promise.resolve([{ id: 'q-1' }]);
            return { returning: () => p };
          },
        }),
      }),
  },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: 'tenant-1', userId: 'user-1', isSuperAdmin: false }),
  requireModule: async () => null,
  requirePerm: async () => null,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T) => h }));

import { POST } from '@/app/api/tenant/quotes/route';

beforeEach(() => {
  H.lineRows = [];
});

function postQuote(body: unknown) {
  const req = new Request('http://localhost/api/tenant/quotes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return POST(req);
}

describe('#3108 quote line items persist the tax_rate the client sent', () => {
  it('stores tax_percent 18 for a line created with tax_rate: 18', async () => {
    const res = await postQuote({
      title: 'Acme rollout',
      line_items: [{ description: 'Seat licence', quantity: 2, unit_price: 100, tax_rate: 18 }],
    });
    expect(res.status).toBeLessThan(500);

    expect(H.lineRows).toHaveLength(1);
    expect(H.lineRows[0].taxPercent).toBe('18');
    expect(H.lineRows[0].quantity).toBe('2');
    expect(H.lineRows[0].unitPrice).toBe('100');
    expect(H.lineRows[0].total).toBe('200.00');
  });

  it('defaults tax_percent to 0 only when the line genuinely omitted tax_rate', async () => {
    await postQuote({
      title: 'No tax line',
      line_items: [{ description: 'Flat item', quantity: 1, unit_price: 50 }],
    });
    expect(H.lineRows[0].taxPercent).toBe('0');
  });

  it('the route no longer reads the stripped tax_amount key', async () => {
    const fs = await import('fs');
    const code = fs.readFileSync('app/api/tenant/quotes/route.ts', 'utf-8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/item\.tax_amount/);
    expect(code).toMatch(/item\.tax_rate/);
  });
});
