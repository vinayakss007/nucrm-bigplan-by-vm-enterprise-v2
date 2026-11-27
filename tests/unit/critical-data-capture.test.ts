import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbExecute = vi.fn();
const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockFindFirst = vi.fn();
const mockTxExecute = vi.fn();
const mockTxUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const mockTxUpdate = vi.fn().mockReturnValue({ set: mockTxUpdateSet });

/** The transaction handle the mock hands to db.transaction callbacks. */
type MockTx = {
  query: { criticalDataBackups: { findFirst: typeof mockFindFirst } };
  execute: typeof mockTxExecute;
  update: typeof mockTxUpdate;
};

const mockTransaction = vi.fn((cb: (tx: MockTx) => Promise<unknown>) => {
  const mockTx: MockTx = {
    query: { criticalDataBackups: { findFirst: mockFindFirst } },
    execute: mockTxExecute,
    update: mockTxUpdate,
  };
  return cb(mockTx);
});

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    select: (..._args: unknown[]) => ({
      from: (..._fargs: unknown[]) => ({
        where: (..._wargs: unknown[]) => Object.assign(
          Promise.resolve([{ total_backups: 0, restorable: 0, deleted_records: 0, updated_records: 0 }]),
          {
            groupBy: (..._gargs: unknown[]) => ({
              orderBy: (..._oargs: unknown[]) => Promise.resolve([]),
            }),
            orderBy: (..._oargs: unknown[]) => Promise.resolve([]),
            limit: (..._largs: unknown[]) => Promise.resolve([]),
          }
        ),
      }),
    }),
    query: {
      criticalDataBackups: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
    transaction: (...args: unknown[]) => mockTransaction(...args),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  criticalDataBackups: {},
  quotes: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  gte: (a: unknown, b: unknown) => ({ op: 'gte', a, b }),
  lte: (a: unknown, b: unknown) => ({ op: 'lte', a, b }),
  desc: (a: unknown) => ({ op: 'desc', a }),
  count: () => ({ op: 'count' }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values }),
    {
      identifier: (name: string) => ({ op: 'identifier', name }),
      join: (parts: unknown[], separator: unknown) => ({ op: 'join', parts, separator }),
    }
  ),
  isNull: (a: unknown) => ({ op: 'isNull', a }),
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

    const restorableBackup = {
      id: 'backup-1',
      tableName: 'contacts',
      recordId: 'contact-1',
      canRestore: true,
      backupData: { id: 'contact-1', name: 'Alice' },
    };

    it('does not consume a backup when the INSERT matched zero rows', async () => {
      mockFindFirst.mockResolvedValue(restorableBackup);
      mockTxExecute.mockResolvedValue({ rowCount: 0, rows: [] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();

      const result = await cdc.restoreFromBackup('backup-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('0 rows');
      expect(mockTxExecute.mock.calls[0]?.[0]?.sql).toContain('RETURNING id');
      expect(mockTxUpdateSet).not.toHaveBeenCalled();
    });

    it('fails closed when the driver result carries no row evidence', async () => {
      mockFindFirst.mockResolvedValue(restorableBackup);
      mockTxExecute.mockResolvedValue({});
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();

      const result = await cdc.restoreFromBackup('backup-1');

      expect(result.success).toBe(false);
      expect(mockTxUpdateSet).not.toHaveBeenCalled();
    });

    it('marks the backup consumed only when one row is confirmed', async () => {
      mockFindFirst.mockResolvedValue(restorableBackup);
      mockTxExecute.mockResolvedValue({ rowCount: 1, rows: [{ id: 'contact-1' }] });
      const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
      const cdc = new CriticalDataCapture();

      const result = await cdc.restoreFromBackup('backup-1');

      expect(result.message).toContain('Restored');
      expect(result.success).toBe(true);
      expect(mockTxUpdateSet).toHaveBeenCalledWith({ canRestore: false });
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
