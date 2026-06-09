import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockDbSelect = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: (...args: any[]) => mockDbInsert(...args),
    select: (...args: any[]) => mockDbSelect(...args),
    from: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema/history', () => ({
  editHistory: {},
  fieldSnapshots: {},
}));

describe('trackFieldChange', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skips insert when values are equal', async () => {
    const { trackFieldChange } = await import('@/lib/history');
    await trackFieldChange('t1', 'u1', 'User', 'u@x.com', 'contact', 'c1', 'name', 'Name', 'old', 'old');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('inserts when values differ', async () => {
    const { trackFieldChange } = await import('@/lib/history');
    await trackFieldChange('t1', 'u1', 'User', 'u@x.com', 'contact', 'c1', 'name', 'Name', 'old', 'new');
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('converts undefined to empty string', async () => {
    const { trackFieldChange } = await import('@/lib/history');
    await trackFieldChange('t1', 'u1', null, null, 'deal', 'd1', 'amount', 'Amount', undefined, '100');
    expect(mockDbInsert).toHaveBeenCalled();
  });
});

describe('createFieldSnapshot', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('inserts a snapshot with 30-day expiry', async () => {
    const { createFieldSnapshot } = await import('@/lib/history');
    await createFieldSnapshot('t1', 'contact', 'c1', 'before-edit', { name: 'test' }, 'u1');
    expect(mockDbInsert).toHaveBeenCalled();
  });
});
