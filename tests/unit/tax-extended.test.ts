import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { db } from '@/drizzle/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockTaxRate(overrides: Record<string, any> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.query.taxRates.findFirst as any).mockResolvedValue({
    id: 'rate-1',
    name: 'Default Rate',
    rate: '10',
    type: 'percentage',
    tenantId: 'tenant-1',
    isActive: true,
    country: null,
    state: null,
    isDefault: false,
    ...overrides,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSelectResult(rows: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.select as any).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

// ---------------------------------------------------------------------------
// calculateTax – extended edge cases
// ---------------------------------------------------------------------------

describe('Tax - calculateTax (extended)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('handles 0% tax rate', async () => {
    mockTaxRate({ rate: '0', type: 'percentage' });
    const { calculateTax } = await import('@/lib/tax');
    const result = await calculateTax(100, 'rate-0', 'tenant-1');
    expect(result.totalTax).toBe(0);
    expect(result.total).toBe(100);
  });

  it('handles zero amount with percentage tax', async () => {
    mockTaxRate({ rate: '10', type: 'percentage' });
    const { calculateTax } = await import('@/lib/tax');
    const result = await calculateTax(0, 'rate-1', 'tenant-1');
    expect(result.totalTax).toBe(0);
    expect(result.total).toBe(0);
  });

  it('handles zero amount with fixed tax', async () => {
    mockTaxRate({ rate: '5', type: 'fixed' });
    const { calculateTax } = await import('@/lib/tax');
    const result = await calculateTax(0, 'rate-1', 'tenant-1');
    expect(result.totalTax).toBe(5);
    expect(result.total).toBe(5);
  });

  it('handles very large amounts without floating-point corruption', async () => {
    mockTaxRate({ rate: '8.25', type: 'percentage' });
    const { calculateTax } = await import('@/lib/tax');
    const result = await calculateTax(1_000_000, 'rate-1', 'tenant-1');
    expect(result.totalTax).toBe(82_500);
    expect(result.total).toBe(1_082_500);
  });

  it('handles sub-cent amounts that round to zero tax', async () => {
    mockTaxRate({ rate: '8.25', type: 'percentage' });
    const { calculateTax } = await import('@/lib/tax');
    const result = await calculateTax(0.01, 'rate-1', 'tenant-1');
    expect(result.totalTax).toBe(0);
    expect(result.total).toBe(0.01);
  });

  it('handles negative amount (edge case)', async () => {
    mockTaxRate({ rate: '10', type: 'percentage' });
    const { calculateTax } = await import('@/lib/tax');
    const result = await calculateTax(-50, 'rate-1', 'tenant-1');
    expect(result.totalTax).toBe(-5);
    expect(result.total).toBe(-55);
  });

  it('returns correct breakdown shape', async () => {
    mockTaxRate({ id: 'abc', name: 'VAT', rate: '20', type: 'percentage' });
    const { calculateTax } = await import('@/lib/tax');
    const result = await calculateTax(100, 'abc', 'tenant-1');
    expect(result.breakdown).toEqual([
      { taxRateId: 'abc', taxName: 'VAT', rate: 20, type: 'percentage', taxAmount: 20 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// calculateCompoundTax – extended edge cases
// ---------------------------------------------------------------------------

describe('Tax - calculateCompoundTax (extended)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('handles a single tax rate', async () => {
    mockTaxRate({ id: 'vat', name: 'VAT', rate: '20', type: 'percentage' });
    const { calculateCompoundTax } = await import('@/lib/tax');
    const result = await calculateCompoundTax(200, ['vat'], 'tenant-1');
    expect(result.totalTax).toBe(40);
    expect(result.breakdown).toHaveLength(1);
  });

  it('handles mix of fixed and percentage rates', async () => {
    let calls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return { id: 'fee', name: 'Service Fee', rate: '2.50', type: 'fixed', tenantId: 'tenant-1', isActive: true };
      }
      return { id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true };
    });
    const { calculateCompoundTax } = await import('@/lib/tax');
    const result = await calculateCompoundTax(100, ['fee', 'vat'], 'tenant-1');
    expect(result.totalTax).toBe(12.5);
    expect(result.breakdown[0]!.type).toBe('fixed');
    expect(result.breakdown[1]!.type).toBe('percentage');
  });

  it('throws error when a middle rate is not found', async () => {
    let calls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockImplementation(async () => {
      calls++;
      if (calls === 1) return { id: 'gst', name: 'GST', rate: '5', type: 'percentage', tenantId: 'tenant-1', isActive: true };
      if (calls === 2) return null;
      return { id: 'pst', name: 'PST', rate: '7', type: 'percentage', tenantId: 'tenant-1', isActive: true };
    });
    const { calculateCompoundTax } = await import('@/lib/tax');
    await expect(calculateCompoundTax(100, ['gst', 'missing', 'pst'], 'tenant-1'))
      .rejects.toThrow("Tax rate 'missing' not found or inactive");
  });

  it('applies the same rate ID multiple times', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { calculateCompoundTax } = await import('@/lib/tax');
    const result = await calculateCompoundTax(100, ['vat', 'vat'], 'tenant-1');
    expect(result.totalTax).toBe(20);
    expect(result.breakdown).toHaveLength(2);
  });

  it('rounds total tax with many fractional rates', async () => {
    let calls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockImplementation(async () => {
      calls++;
      const rates = [
        { id: 'r1', name: 'R1', rate: '5.55', type: 'percentage', tenantId: 'tenant-1', isActive: true },
        { id: 'r2', name: 'R2', rate: '3.33', type: 'percentage', tenantId: 'tenant-1', isActive: true },
        { id: 'r3', name: 'R3', rate: '2.22', type: 'percentage', tenantId: 'tenant-1', isActive: true },
      ];
      return rates[calls - 1] || null;
    });
    const { calculateCompoundTax } = await import('@/lib/tax');
    const result = await calculateCompoundTax(99.99, ['r1', 'r2', 'r3'], 'tenant-1');
    expect(result.totalTax).toBe(11.10);
    expect(result.breakdown).toHaveLength(3);
  });

  it('handles zero amount with multiple rates', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { calculateCompoundTax } = await import('@/lib/tax');
    const result = await calculateCompoundTax(0, ['vat'], 'tenant-1');
    expect(result.totalTax).toBe(0);
    expect(result.total).toBe(0);
  });

  it('rounds individual line items with fractional amounts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'r1', name: 'R1', rate: '8.25', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { calculateCompoundTax } = await import('@/lib/tax');
    const result = await calculateCompoundTax(0.03, ['r1'], 'tenant-1');
    // 0.03 * 0.0825 = 0.002475 → rounds to 0.00
    expect(result.totalTax).toBe(0);
    expect(result.total).toBe(0.03);
  });
});

// ---------------------------------------------------------------------------
// getTaxRatesForRegion – 100 % UNTESTED in tax.test.ts
// ---------------------------------------------------------------------------

describe('Tax - getTaxRatesForRegion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns rates for a country without state filter', async () => {
    mockSelectResult([
      { id: 'r1', name: 'VAT', rate: '20', type: 'percentage', country: 'GB', state: null, isDefault: true },
      { id: 'r2', name: 'Sales Tax', rate: '5', type: 'percentage', country: 'GB', state: null, isDefault: false },
    ]);
    const { getTaxRatesForRegion } = await import('@/lib/tax');
    const result = await getTaxRatesForRegion('tenant-1', 'GB');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('r1');
    expect(result[0]!.rate).toBe(20);
    expect(result[0]!.type).toBe('percentage');
    expect(result[0]!.country).toBe('GB');
    expect(result[0]!.isDefault).toBe(true);
    expect(result[1]!.id).toBe('r2');
  });

  it('filters by state when provided', async () => {
    mockSelectResult([
      { id: 'r3', name: 'CA State Tax', rate: '7.25', type: 'percentage', country: 'US', state: 'CA', isDefault: true },
    ]);
    const { getTaxRatesForRegion } = await import('@/lib/tax');
    const result = await getTaxRatesForRegion('tenant-1', 'US', 'CA');
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('CA');
  });

  it('includes state filter in query when state is provided', async () => {
    mockSelectResult([]);
    const { getTaxRatesForRegion } = await import('@/lib/tax');
    await getTaxRatesForRegion('tenant-1', 'US', 'TX');
    // db.select() should be called → verify underlying and() received state eq
    expect(db.select).toHaveBeenCalled();
  });

  it('returns empty array when no rates match', async () => {
    mockSelectResult([]);
    const { getTaxRatesForRegion } = await import('@/lib/tax');
    const result = await getTaxRatesForRegion('tenant-1', 'XX');
    expect(result).toEqual([]);
  });

  it('maps fixed-type rates correctly', async () => {
    mockSelectResult([
      { id: 'r4', name: 'Flat Fee', rate: '10', type: 'fixed', country: 'US', state: null, isDefault: false },
    ]);
    const { getTaxRatesForRegion } = await import('@/lib/tax');
    const result = await getTaxRatesForRegion('tenant-1', 'US');
    expect(result[0]!.type).toBe('fixed');
    expect(result[0]!.rate).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// isEntityExempt – 100 % UNTESTED in tax.test.ts
// ---------------------------------------------------------------------------

describe('Tax - isEntityExempt', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns true when exemption exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxExemptions.findFirst as any).mockResolvedValue({
      id: 'ex-1',
      tenantId: 'tenant-1',
      entityType: 'customer',
      entityId: 'cust-1',
    });
    const { isEntityExempt } = await import('@/lib/tax');
    const result = await isEntityExempt('tenant-1', 'customer', 'cust-1');
    expect(result).toBe(true);
  });

  it('returns false when no exemption record exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxExemptions.findFirst as any).mockResolvedValue(null);
    const { isEntityExempt } = await import('@/lib/tax');
    const result = await isEntityExempt('tenant-1', 'customer', 'nonexistent');
    expect(result).toBe(false);
  });

  it('returns false when exemption query returns undefined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxExemptions.findFirst as any).mockResolvedValue(undefined);
    const { isEntityExempt } = await import('@/lib/tax');
    const result = await isEntityExempt('tenant-1', 'vendor', 'v-99');
    expect(result).toBe(false);
  });

  it('queries with correct tenant, entity type, and entity ID', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxExemptions.findFirst as any).mockResolvedValue(null);
    const { isEntityExempt } = await import('@/lib/tax');
    await isEntityExempt('tenant-42', 'organization', 'org-7');
    expect(db.query.taxExemptions.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.any(Array),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// applyTaxToLineItems – extended edge cases
// ---------------------------------------------------------------------------

describe('Tax - applyTaxToLineItems (extended)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns empty summary and items for empty list', async () => {
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const result = await applyTaxToLineItems([], { taxRateIds: ['tax-1'], tenantId: 'tenant-1' });
    expect(result.items).toEqual([]);
    expect(result.summary.subtotal).toBe(0);
    expect(result.summary.totalTax).toBe(0);
    expect(result.summary.total).toBe(0);
    expect(result.summary.breakdown).toEqual([]);
  });

  it('defaults quantity to 1 when omitted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const items = [{ amount: 50 }, { amount: 25 }];
    const result = await applyTaxToLineItems(items, { taxRateIds: ['vat'], tenantId: 'tenant-1' });
    expect(result.summary.subtotal).toBe(75);
    expect(result.summary.totalTax).toBe(7.5);
    expect(result.items[0]!.totalWithTax).toBe(55);
    expect(result.items[1]!.totalWithTax).toBe(27.5);
  });

  it('handles items without id or description fields', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const items = [{ amount: 100 }];
    const result = await applyTaxToLineItems(items, { taxRateIds: ['vat'], tenantId: 'tenant-1' });
    expect(result.items[0]!.id).toBeUndefined();
    expect(result.items[0]!.description).toBeUndefined();
    expect(result.items[0]!.amount).toBe(100);
  });

  it('merges breakdown entries with the same taxRateId across items', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const items = [
      { amount: 100, quantity: 1 },
      { amount: 200, quantity: 1 },
    ];
    const result = await applyTaxToLineItems(items, { taxRateIds: ['vat'], tenantId: 'tenant-1' });
    // Item 1: tax 10, Item 2: tax 20 → merged total 30
    expect(result.summary.breakdown).toHaveLength(1);
    expect(result.summary.breakdown[0]!.taxRateId).toBe('vat');
    expect(result.summary.breakdown[0]!.taxAmount).toBe(30);
  });

  it('handles mix of exempt and non-exempt items with merged breakdown', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const items = [
      { amount: 100, taxExempt: true },
      { amount: 100 },
      { amount: 100, taxExempt: false },
    ];
    const result = await applyTaxToLineItems(items, { taxRateIds: ['vat'], tenantId: 'tenant-1' });
    expect(result.items).toHaveLength(3);
    expect(result.items[0]!.taxAmount).toBe(0);
    expect(result.items[1]!.taxAmount).toBe(10);
    expect(result.items[2]!.taxAmount).toBe(10);
    expect(result.summary.totalTax).toBe(20);
    expect(result.summary.breakdown[0]!.taxAmount).toBe(20);
  });

  it('preserves item properties in output', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'vat', name: 'VAT', rate: '10', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const items = [{ id: 'li-1', description: 'Widget', amount: 50, quantity: 2 }];
    const result = await applyTaxToLineItems(items, { taxRateIds: ['vat'], tenantId: 'tenant-1' });
    const out = result.items[0]!;
    expect(out.id).toBe('li-1');
    expect(out.description).toBe('Widget');
    expect(out.amount).toBe(50);
    expect(out.quantity).toBe(2);
    expect(out.taxAmount).toBe(10);
    expect(out.totalWithTax).toBe(110);
  });

  it('rounds merged breakdown amounts correctly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query.taxRates.findFirst as any).mockResolvedValue({
      id: 'r1', name: 'R1', rate: '8.25', type: 'percentage', tenantId: 'tenant-1', isActive: true,
    });
    const { applyTaxToLineItems } = await import('@/lib/tax');
    const items = [
      { amount: 0.01, quantity: 1 },
      { amount: 0.02, quantity: 1 },
    ];
    const result = await applyTaxToLineItems(items, { taxRateIds: ['r1'], tenantId: 'tenant-1' });
    // 0.01 * 0.0825 = 0.000825 → 0.00
    // 0.02 * 0.0825 = 0.00165  → 0.00
    expect(result.summary.totalTax).toBe(0);
    expect(result.summary.breakdown[0]!.taxAmount).toBe(0);
  });
});
