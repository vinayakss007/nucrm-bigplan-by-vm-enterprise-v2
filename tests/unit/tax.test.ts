import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateTax, calculateCompoundTax, applyTaxToLineItems } from '@/lib/tax';

// Mock DB
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    query: {
      taxRates: {
        findFirst: vi.fn(),
      },
      taxExemptions: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock('@/drizzle/schema/financial', () => ({
  taxRates: { id: 'id', tenantId: 'tenant_id', isActive: 'is_active', country: 'country', state: 'state' },
  taxExemptions: { id: 'id', tenantId: 'tenant_id', entityType: 'entity_type', entityId: 'entity_id' },
}));

vi.mock('drizzle-orm', () => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  eq: vi.fn((...args: any[]) => args),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  and: vi.fn((...args: any[]) => args),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  desc: vi.fn((col: any) => col),
  sql: vi.fn(),
}));

// Get reference to mock for setup
import { db } from '@/drizzle/db';

describe('Tax - calculateTax', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates percentage-based tax correctly', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'tax-1',
      name: 'Sales Tax',
      rate: '10',
      type: 'percentage',
      tenantId: 'tenant-1',
      isActive: true,
    });

    const result = await calculateTax(100, 'tax-1', 'tenant-1');

    expect(result.subtotal).toBe(100);
    expect(result.totalTax).toBe(10);
    expect(result.total).toBe(110);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]!.taxName).toBe('Sales Tax');
  });

  it('calculates fixed-amount tax correctly', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'tax-2',
      name: 'Flat Fee',
      rate: '5',
      type: 'fixed',
      tenantId: 'tenant-1',
      isActive: true,
    });

    const result = await calculateTax(200, 'tax-2', 'tenant-1');

    expect(result.subtotal).toBe(200);
    expect(result.totalTax).toBe(5);
    expect(result.total).toBe(205);
    expect(result.breakdown[0]!.type).toBe('fixed');
  });

  it('throws error for non-existent tax rate', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue(null);

    await expect(calculateTax(100, 'invalid', 'tenant-1'))
      .rejects.toThrow("Tax rate 'invalid' not found or inactive");
  });

  it('handles decimal amounts with rounding', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'tax-3',
      name: 'GST',
      rate: '7.5',
      type: 'percentage',
      tenantId: 'tenant-1',
      isActive: true,
    });

    const result = await calculateTax(33.33, 'tax-3', 'tenant-1');

    expect(result.totalTax).toBe(2.5); // 33.33 * 0.075 = 2.49975, rounds to 2.50
    expect(result.total).toBe(35.83);
  });
});

describe('Tax - calculateCompoundTax', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates compound tax with multiple rates', async () => {
    let callCount = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { id: 'gst', name: 'GST', rate: '5', type: 'percentage', tenantId: 'tenant-1', isActive: true };
      }
      return { id: 'pst', name: 'PST', rate: '7', type: 'percentage', tenantId: 'tenant-1', isActive: true };
    });

    const result = await calculateCompoundTax(100, ['gst', 'pst'], 'tenant-1');

    expect(result.subtotal).toBe(100);
    expect(result.totalTax).toBe(12); // 5 + 7
    expect(result.total).toBe(112);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]!.taxName).toBe('GST');
    expect(result.breakdown[1]!.taxName).toBe('PST');
  });

  it('returns zero tax for empty rate list', async () => {
    const result = await calculateCompoundTax(100, [], 'tenant-1');

    expect(result.subtotal).toBe(100);
    expect(result.totalTax).toBe(0);
    expect(result.total).toBe(100);
    expect(result.breakdown).toHaveLength(0);
  });
});

describe('Tax - applyTaxToLineItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies tax to non-exempt items', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'tax-1',
      name: 'VAT',
      rate: '20',
      type: 'percentage',
      tenantId: 'tenant-1',
      isActive: true,
    });

    const items = [
      { amount: 50, quantity: 2 },
      { amount: 30, quantity: 1 },
    ];

    const result = await applyTaxToLineItems(items, {
      taxRateIds: ['tax-1'],
      tenantId: 'tenant-1',
    });

    // 50*2=100, tax=20; 30*1=30, tax=6; total tax=26
    expect(result.summary.subtotal).toBe(130);
    expect(result.summary.totalTax).toBe(26);
    expect(result.summary.total).toBe(156);
    expect(result.items).toHaveLength(2);
  });

  it('skips tax-exempt items', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'tax-1',
      name: 'VAT',
      rate: '20',
      type: 'percentage',
      tenantId: 'tenant-1',
      isActive: true,
    });

    const items = [
      { amount: 100, quantity: 1, taxExempt: true },
      { amount: 100, quantity: 1, taxExempt: false },
    ];

    const result = await applyTaxToLineItems(items, {
      taxRateIds: ['tax-1'],
      tenantId: 'tenant-1',
    });

    // First item exempt (0 tax), second item 20% = 20
    expect(result.summary.totalTax).toBe(20);
    expect(result.items[0]!.taxAmount).toBe(0);
    expect(result.items[1]!.taxAmount).toBe(20);
  });
});
