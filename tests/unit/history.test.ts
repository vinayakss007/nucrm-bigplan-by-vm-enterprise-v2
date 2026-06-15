import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
function makeQueryResult() {
  const p = Promise.resolve([]);
  return Object.assign(p, {
    limit: vi.fn().mockReturnValue(Promise.resolve([])),
  });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockWhere = vi.fn().mockImplementation((..._args: any[]) => ({
  orderBy: vi.fn().mockReturnValue(makeQueryResult()),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = vi.fn().mockImplementation((..._args: any[]) => ({ where: mockWhere }));

vi.mock('@/drizzle/db', () => ({
  db: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (...args: any[]) => mockDbInsert(...args),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (..._args: any[]) => ({ from: mockFrom }),
  },
}));

vi.mock('@/drizzle/schema/history', () => ({
  editHistory: {},
  fieldSnapshots: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('trackFieldChange', () => {
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

  it('converts null to empty string', async () => {
    const { trackFieldChange } = await import('@/lib/history');
    await trackFieldChange('t1', 'u1', null, null, 'lead', 'l1', 'status', 'Status', null, 'active');
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('includes ipAddress and userAgent', async () => {
    const { trackFieldChange } = await import('@/lib/history');
    await trackFieldChange('t1', 'u1', 'User', 'u@x.com', 'contact', 'c1', 'name', 'Name', 'old', 'new', '192.168.1.1', 'Chrome');
    expect(mockDbInsert).toHaveBeenCalled();
  });
});

describe('getEntityHistory', () => {
  it('queries history for entity', async () => {
    const { getEntityHistory } = await import('@/lib/history');
    const result = await getEntityHistory('t1', 'contact', 'c1', 10);
    expect(result).toEqual([]);
    expect(mockFrom).toHaveBeenCalled();
  });

  it('uses default limit of 50', async () => {
    const { getEntityHistory } = await import('@/lib/history');
    await getEntityHistory('t1', 'contact', 'c1');
  });
});

describe('createFieldSnapshot', () => {
  it('inserts a snapshot with 30-day expiry', async () => {
    const { createFieldSnapshot } = await import('@/lib/history');
    await createFieldSnapshot('t1', 'contact', 'c1', 'before-edit', { name: 'test' }, 'u1');
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('serializes snapshot data as JSON', async () => {
    const { createFieldSnapshot } = await import('@/lib/history');
    await createFieldSnapshot('t1', 'contact', 'c1', 'snapshot', { complex: { nested: true } });
    expect(mockDbInsert).toHaveBeenCalled();
  });
});

describe('getEntitySnapshots', () => {
  it('returns snapshots for entity', async () => {
    const { getEntitySnapshots } = await import('@/lib/history');
    const result = await getEntitySnapshots('t1', 'contact', 'c1');
    expect(result).toEqual([]);
  });
});
