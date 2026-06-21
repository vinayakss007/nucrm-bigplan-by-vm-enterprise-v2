import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockWhere = vi.fn(() => [{ count: 0 }]);
let mockGroupBy = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      webhookDeliveries: { findFirst: vi.fn() },
      deadLetterQueue: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: 'dlq-1' }])) })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockWhere,
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve({ rowCount: 1 })) })),
  },
}));

vi.mock('@/drizzle/schema/automation', () => ({
  deadLetterQueue: { id: 'id', tenantId: 'tenant_id' },
  webhookDeliveries: { id: 'id', tenantId: 'tenant_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a) => ({ type: 'eq', args: a })),
  and: vi.fn((...a) => ({ type: 'and', args: a })),
  sql: Object.assign(vi.fn((...a) => ({ type: 'sql', args: a })), { raw: vi.fn() }),
  desc: vi.fn((...a) => ({ type: 'desc', args: a })),
}));

vi.mock('@/lib/dev-logger', () => ({
  devLogger: { queue: vi.fn(), error: vi.fn() },
}));

describe('Webhook Dead Letter Queue', () => {
  let mod: typeof import('@/lib/webhooks/dlq');

  beforeEach(async () => {
    mockWhere = vi.fn(() => [{ count: 0 }]);
    mockGroupBy = vi.fn();
    vi.clearAllMocks();
    mod = await import('@/lib/webhooks/dlq');
  });

  describe('moveToDeadLetterQueue', () => {
    it('returns null when delivery not found', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.webhookDeliveries.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      expect(await mod.moveToDeadLetterQueue('nonexistent')).toBeNull();
    });

    it('returns null when delivery is not failed', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.webhookDeliveries.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'pending' });
      expect(await mod.moveToDeadLetterQueue('d-1')).toBeNull();
    });

    it('inserts DLQ entry for failed delivery', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.webhookDeliveries.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'd-1', tenantId: 't-1', webhookId: 'wh-1', eventType: 'test',
        payload: { msg: 'hello' }, status: 'failed', createdAt: new Date(),
        metadata: { attempt: 3, maxRetries: 3, failureReason: 'Timeout', url: 'https://x.com/hook' },
      });

      expect(await mod.moveToDeadLetterQueue('d-1')).toBe('dlq-1');
    });
  });

  describe('retryFromDLQ', () => {
    it('returns false when DLQ entry not found', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.deadLetterQueue.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      expect(await mod.retryFromDLQ('nonexistent')).toBe(false);
    });

    it('throws when DLQ entry is not pending', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.deadLetterQueue.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'resolved' });
      await expect(mod.retryFromDLQ('dlq-1')).rejects.toThrow('not retryable');
    });
  });

  describe('listDLQEntries', () => {
    it('returns paginated entries with total', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.deadLetterQueue.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'dlq-1' }]);
      mockWhere.mockReturnValueOnce([{ count: 1 }]);

      const result = await mod.listDLQEntries('t-1', { limit: 10, offset: 0 });
      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getDLQStats', () => {
    it('aggregates stats by status', async () => {
      mockWhere.mockReturnValueOnce({ groupBy: mockGroupBy });
      mockGroupBy.mockResolvedValueOnce([
        { status: 'pending', count: 5 },
        { status: 'resolved', count: 3 },
        { status: 'failed', count: 2 },
      ]);
      const stats = await mod.getDLQStats('t-1');
      expect(stats.total).toBe(10);
      expect(stats.pending).toBe(5);
      expect(stats.resolved).toBe(3);
      expect(stats.failed).toBe(2);
    });

    it('returns zeros when no entries', async () => {
      mockWhere.mockReturnValueOnce({ groupBy: mockGroupBy });
      mockGroupBy.mockResolvedValueOnce([]);
      const stats = await mod.getDLQStats('t-1');
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.resolved).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('bulkRetryDLQ', () => {
    it('returns succeeded and failed counts', async () => {
      const { db } = await import('@/drizzle/db');
      const findFirst = db.query.deadLetterQueue.findFirst as ReturnType<typeof vi.fn>;
      findFirst
        .mockResolvedValueOnce({ status: 'pending', payload: { deliveryId: 'd-1' }, maxAttempts: 3 })
        .mockResolvedValueOnce({ status: 'pending', payload: { deliveryId: 'd-2' }, maxAttempts: 3 });

      const result = await mod.bulkRetryDLQ(['dlq-1', 'dlq-2']);
      expect(result.succeeded + result.failed).toBe(2);
    });
  });

  describe('purgeDLQEntry', () => {
    it('returns true when delete succeeds', async () => {
      expect(await mod.purgeDLQEntry('dlq-1', 't-1')).toBe(true);
    });
  });

  describe('purgeOldDLQEntries', () => {
    it('returns count of purged entries', async () => {
      const result = await mod.purgeOldDLQEntries(30);
      expect(typeof result).toBe('number');
    });
  });
});
