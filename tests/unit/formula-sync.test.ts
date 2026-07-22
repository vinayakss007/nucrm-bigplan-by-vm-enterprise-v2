import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncCalculatedFields } from '../../lib/formula/sync';

const { mockSelectResult, mockExecuteResult } = vi.hoisted(() => ({
  mockSelectResult: vi.fn(),
  mockExecuteResult: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockSelectResult,
      })),
    })),
    execute: mockExecuteResult,
  },
}));

vi.mock('@/drizzle/schema', () => ({
  customFieldDefs: {},
}));

describe('syncCalculatedFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResult.mockResolvedValue([]);
    mockExecuteResult.mockResolvedValue(undefined);
  });

  it('returns early when no calculated field defs exist', async () => {
    await syncCalculatedFields('tenant-1', 'contact', 'contact-1', { amount: 100 });
    expect(mockExecuteResult).not.toHaveBeenCalled();
  });

  it('evaluates formulas and updates entity metadata', async () => {
    mockSelectResult.mockResolvedValue([
      { fieldKey: 'commission', formula: '{{amount}} * 0.1' },
    ]);

    await syncCalculatedFields('tenant-1', 'deal', 'deal-1', { amount: 1000 });
    expect(mockExecuteResult).toHaveBeenCalledTimes(1);
  });

  it('handles missing formula gracefully', async () => {
    mockSelectResult.mockResolvedValue([
      { fieldKey: 'commission', formula: null },
    ]);

    await syncCalculatedFields('tenant-2', 'deal', 'deal-2', { amount: 100 });
    expect(mockExecuteResult).not.toHaveBeenCalled();
  });

  it('handles DB errors gracefully', async () => {
    mockSelectResult.mockRejectedValue(new Error('DB error'));

    await syncCalculatedFields('tenant-3', 'contact', 'contact-3', { amount: 100 });
    expect(mockExecuteResult).not.toHaveBeenCalled();
  });

  it('handles unknown entity types gracefully', async () => {
    mockSelectResult.mockResolvedValue([
      { fieldKey: 'custom', formula: '{{val}} * 2' },
    ]);

    await syncCalculatedFields('tenant-4', 'unknown-type', 'entity-1', { val: 5 });
    expect(mockExecuteResult).not.toHaveBeenCalled();
  });
});
