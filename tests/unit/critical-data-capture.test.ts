import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbExecute = vi.fn();
const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockFindFirst = vi.fn();
const mockTxExecute = vi.fn();
const mockTxUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockResolvedValue(undefined) });
const mockTransaction = vi.fn((cb: (tx: any) => any) => {
  const mockTx = {
    query: { criticalDataBackups: { findFirst: mockFindFirst } },
    execute: mockTxExecute,
    update: vi.fn().mockReturnValue({ set: vi.fn().mockResolvedValue(undefined) }),
  };
  return cb(mockTx);
});

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (...args: any[]) => mockDbExecute(...args),
    insert: (...args: any[]) => mockDbInsert(...args),
    select: (..._args: any[]) => ({
      from: (..._fargs: any[]) => ({
        where: (..._wargs: any[]) => Object.assign(
          Promise.resolve([{ total_backups: 0, restorable: 0, deleted_records: 0, updated_records: 0 }]),
          {
            groupBy: (..._gargs: any[]) => ({
              orderBy: (..._oargs: any[]) => Promise.resolve([]),
            }),
            orderBy: (..._oargs: any[]) => Promise.resolve([]),
            limit: (..._largs: any[]) => Promise.resolve([]),
          }
        ),
      }),
    }),
    query: {
      criticalDataBackups: {
        findMany: (...args: any[]) => mockFindMany(...args),
      },
    },
    transaction: (...args: any[]) => mockTransaction(...args),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  criticalDataBackups: {},
  quotes: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ op: 'eq', a, b }),
  and: (...args: any[]) => ({ op: 'and', args }),
  gte: (a: any, b: any) => ({ op: 'gte', a, b }),
  lte: (a: any, b: any) => ({ op: 'lte', a, b }),
  desc: (a: any) => ({ op: 'desc', a }),
  count: () => ({ op: 'count' }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({ sql: strings.join('?'), values }),
    { identifier: (name: string) => ({ op: 'identifier', name }) }
  ),
  isNull: (a: any) => ({ op: 'isNull', a }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CriticalDataCapture', () => {
  describe('captureBeforeDelete', () => {
    it('returns 0 for non-critical table', async () => {
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const count = await cdc.captureBeforeDelete('t1', 'non_critical_table', ['id1']);
      expect(count).toBe(0);
    });

    it('captures data for critical table', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ id: 'id1', name: 'test', value: 100 }] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const count = await cdc.captureBeforeDelete('t1', 'contacts', ['id1']);
      expect(count).toBe(1);
    });

    it('skips missing records', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const count = await cdc.captureBeforeDelete('t1', 'contacts', ['missing_id']);
      expect(count).toBe(0);
    });

    it('captures multiple records', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ id: 'id1', name: 'Alice' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'id2', name: 'Bob' }] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const count = await cdc.captureBeforeDelete('t1', 'contacts', ['id1', 'id2']);
      expect(count).toBe(2);
    });

    it('handles bigint values', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ id: 'id1', amount: BigInt(1000) }] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const count = await cdc.captureBeforeDelete('t1', 'deals', ['id1']);
      expect(count).toBe(1);
    });

    it('handles Date values', async () => {
      const testDate = new Date('2024-01-01');
      mockDbExecute.mockResolvedValue({ rows: [{ id: 'id1', created_at: testDate }] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const count = await cdc.captureBeforeDelete('t1', 'contacts', ['id1']);
      expect(count).toBe(1);
    });

    it('handles errors gracefully', async () => {
      mockDbExecute.mockRejectedValue(new Error('DB error'));
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const count = await cdc.captureBeforeDelete('t1', 'contacts', ['id1']);
      expect(count).toBe(0);
    });
  });

  describe('captureBeforeUpdate', () => {
    it('does nothing for non-critical table', async () => {
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      await cdc.captureBeforeUpdate('t1', 'non_critical', 'id1');
      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it('captures data before update', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ id: 'id1', name: 'old-name' }] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      await cdc.captureBeforeUpdate('t1', 'contacts', 'id1');
      expect(mockDbInsert).toHaveBeenCalled();
    });

    it('skips if record not found', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      await cdc.captureBeforeUpdate('t1', 'contacts', 'missing');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      mockDbExecute.mockRejectedValue(new Error('DB error'));
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      await expect(cdc.captureBeforeUpdate('t1', 'contacts', 'id1')).resolves.not.toThrow();
    });
  });

  describe('restoreFromBackup', () => {
    it('returns failure for missing backup', async () => {
      mockFindFirst.mockResolvedValue(null);
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const result = await cdc.restoreFromBackup('nonexistent');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('getStats', () => {
    it('returns stats for all tenants', async () => {
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();
      const stats = await cdc.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });
  });
});
