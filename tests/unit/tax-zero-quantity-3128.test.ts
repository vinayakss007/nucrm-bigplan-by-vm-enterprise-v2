/**
 * #3128 — `applyTaxToLineItems` priced each line with `item.quantity || 1`.
 * `LineItem.quantity` is optional, so that default means "absent means one",
 * but it also turned an explicit 0 into one unit — and `/api/tenant/tax/calculate`
 * hands it `items` straight out of the request body (`route.ts:51`), so a client
 * quoting tax on a zero-quantity line got a non-zero subtotal and a tax charge
 * for an item that costs nothing. Same mis-billing shape #3109 removed from
 * orders, on the endpoint the document routes call for their tax figures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    query: {
      taxRates: { findFirst: vi.fn() },
      taxExemptions: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/drizzle/schema/financial', () => ({
  taxRates: { id: 'id', tenantId: 'tenant_id', isActive: 'is_active', country: 'country', state: 'state' },
  taxExemptions: { id: 'id', tenantId: 'tenant_id', entityType: 'entity_type', entityId: 'entity_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
  sql: vi.fn(),
}));

import { db } from '@/drizzle/db';

const CONFIG = { taxRateIds: ['vat'], tenantId: 'tenant-1' };

describe('#3128 applyTaxToLineItems keeps an explicit quantity of 0 at zero cost', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(db.query.taxRates.findFirst).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
  });

  it('charges no subtotal and no tax on a zero-quantity line', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const result = await applyTaxToLineItems(
      [{ description: 'free sample', amount: 50, quantity: 0 }, { description: 'paid', amount: 10, quantity: 2 }],
      CONFIG,
    );

    // `|| 1` billed the 50-unit sample once: subtotal 70, tax 7.
    expect(result.summary.subtotal).toBe(20);
    expect(result.summary.totalTax).toBe(2);
    expect(result.summary.total).toBe(22);

    const gift = result.items[0]!;
    expect(gift.totalWithTax).toBe(0);
    expect(gift.taxAmount).toBe(0);
    expect(result.items[1]!.taxAmount).toBe(2);
  });

  it('still treats an omitted quantity as one unit', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const result = await applyTaxToLineItems([{ description: 'no qty key', amount: 40 }], CONFIG);

    expect(result.summary.subtotal).toBe(40);
    expect(result.summary.totalTax).toBe(4);
  });

  it('leaves a tax-exempt zero-quantity line at zero rather than one unit', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const result = await applyTaxToLineItems([{ amount: 50, quantity: 0, taxExempt: true }], CONFIG);

    expect(result.summary.subtotal).toBe(0);
    expect(result.items[0]!.totalWithTax).toBe(0);
    expect(result.items[0]!.taxBreakdown).toEqual([]);
  });
});
