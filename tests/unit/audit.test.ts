import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAudit, verifyAuditChain } from '../../lib/audit';

const mockInsertValues = vi.fn();
const mockWhereResult = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: mockWhereResult,
          })),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  auditLogs: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logAudit', () => {
    it('returns early when tenantId is missing', async () => {
      await logAudit({
        action: 'test',
        entityType: 'deal',
      });
      expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it('inserts audit log with computed hash', async () => {
      mockWhereResult.mockResolvedValue([]);
      mockInsertValues.mockResolvedValue(undefined);

      await logAudit({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'update',
        entityType: 'deal',
        entityId: 'deal-1',
        oldData: { name: 'Old' },
        newData: { name: 'New' },
        metadata: { reason: 'test' },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      expect(mockInsertValues).toHaveBeenCalledTimes(1);
      const inserted = mockInsertValues.mock.calls[0][0];
      expect(inserted.tenantId).toBe('tenant-1');
      expect(inserted.hash).toBeDefined();
      expect(typeof inserted.hash).toBe('string');
      expect(inserted.hash).toHaveLength(64);
    });

    it('handles missing optional fields with defaults', async () => {
      mockWhereResult.mockResolvedValue([]);
      mockInsertValues.mockResolvedValue(undefined);

      await logAudit({
        tenantId: 'tenant-2',
        action: 'delete',
        entityType: 'contact',
      });

      const inserted = mockInsertValues.mock.calls[0][0];
      expect(inserted.userId).toBeNull();
      expect(inserted.entityId).toBeNull();
      expect(inserted.oldData).toBeNull();
      expect(inserted.newData).toBeNull();
      expect(inserted.ipAddress).toBeNull();
      expect(inserted.userAgent).toBeNull();
    });

    it('includes previousHash when logs exist', async () => {
      mockWhereResult.mockResolvedValue([{ hash: 'prev-hash-123' }]);
      mockInsertValues.mockResolvedValue(undefined);

      await logAudit({
        tenantId: 'tenant-3',
        action: 'update',
        entityType: 'deal',
      });

      const inserted = mockInsertValues.mock.calls[0][0];
      expect(inserted.previousHash).toBe('prev-hash-123');
    });

    it('handles DB error gracefully', async () => {
      mockWhereResult.mockRejectedValue(new Error('DB connection failed'));
      const logger = await import('@/lib/logger');

      await logAudit({
        tenantId: 'tenant-4',
        action: 'update',
        entityType: 'deal',
      });

      expect(logger.logger.error).toHaveBeenCalledWith(
        '[audit] Failed to write audit log',
        expect.objectContaining({
          action: 'update',
          entityType: 'deal',
        })
      );
    });
  });

  describe('verifyAuditChain', () => {
    it('returns valid when no logs exist', async () => {
      mockWhereResult.mockResolvedValue([]);

      const result = await verifyAuditChain('tenant-empty');
      expect(result.valid).toBe(true);
      expect(result.totalChecked).toBe(0);
    });

    it('verifies a valid chain of audit logs', async () => {
      const { computeEntryHash } = await import('../../lib/audit');

      const entry1 = {
        id: '1',
        previousHash: null as string | null,
        hash: '',
        tenantId: 'tenant-5',
        userId: 'u1' as string | null,
        action: 'create',
        entityType: 'contact',
        entityId: 'c1' as string | null,
        oldData: null,
        newData: { name: 'Test' },
        metadata: {},
        ipAddress: null as string | null,
        userAgent: null as string | null,
        createdAt: new Date(),
      };
      entry1.hash = computeEntryHash({
        tenantId: entry1.tenantId,
        userId: entry1.userId,
        action: entry1.action,
        entityType: entry1.entityType,
        entityId: entry1.entityId,
        oldData: entry1.oldData,
        newData: entry1.newData,
        metadata: entry1.metadata,
        ipAddress: entry1.ipAddress,
        userAgent: entry1.userAgent,
        previousHash: entry1.previousHash,
      });

      const entry2 = {
        id: '2',
        previousHash: entry1.hash as string | null,
        hash: '',
        tenantId: 'tenant-5',
        userId: 'u1' as string | null,
        action: 'update',
        entityType: 'contact',
        entityId: 'c1' as string | null,
        oldData: { name: 'Test' },
        newData: { name: 'Updated' },
        metadata: {},
        ipAddress: null as string | null,
        userAgent: null as string | null,
        createdAt: new Date(),
      };
      entry2.hash = computeEntryHash({
        tenantId: entry2.tenantId,
        userId: entry2.userId,
        action: entry2.action,
        entityType: entry2.entityType,
        entityId: entry2.entityId,
        oldData: entry2.oldData,
        newData: entry2.newData,
        metadata: entry2.metadata,
        ipAddress: entry2.ipAddress,
        userAgent: entry2.userAgent,
        previousHash: entry2.previousHash,
      });

      mockWhereResult.mockResolvedValue([entry2, entry1]);

      const result = await verifyAuditChain('tenant-5');
      expect(result.valid).toBe(true);
      expect(result.totalChecked).toBe(2);
      expect(result.details).toContain('verified successfully');
    });

    it('detects broken previousHash chain', async () => {
      const { computeEntryHash } = await import('../../lib/audit');

      const entry1 = {
        id: '1',
        previousHash: null as string | null,
        hash: '',
        tenantId: 'tenant-6',
        userId: 'u1' as string | null,
        action: 'create',
        entityType: 'contact',
        entityId: 'c1' as string | null,
        oldData: null,
        newData: { name: 'Test' },
        metadata: {},
        ipAddress: null as string | null,
        userAgent: null as string | null,
        createdAt: new Date(),
      };
      entry1.hash = computeEntryHash({
        tenantId: entry1.tenantId,
        userId: entry1.userId,
        action: entry1.action,
        entityType: entry1.entityType,
        entityId: entry1.entityId,
        oldData: entry1.oldData,
        newData: entry1.newData,
        metadata: entry1.metadata,
        ipAddress: entry1.ipAddress,
        userAgent: entry1.userAgent,
        previousHash: entry1.previousHash,
      });

      const entry2 = {
        id: '2',
        previousHash: 'wrong-hash',
        hash: '',
        tenantId: 'tenant-6',
        userId: 'u1' as string | null,
        action: 'update',
        entityType: 'contact',
        entityId: 'c1' as string | null,
        oldData: { name: 'Test' },
        newData: { name: 'Updated' },
        metadata: {},
        ipAddress: null as string | null,
        userAgent: null as string | null,
        createdAt: new Date(),
      };
      entry2.hash = computeEntryHash({
        tenantId: entry2.tenantId,
        userId: entry2.userId,
        action: entry2.action,
        entityType: entry2.entityType,
        entityId: entry2.entityId,
        oldData: entry2.oldData,
        newData: entry2.newData,
        metadata: entry2.metadata,
        ipAddress: entry2.ipAddress,
        userAgent: entry2.userAgent,
        previousHash: entry2.previousHash,
      });

      mockWhereResult.mockResolvedValue([entry2, entry1]);

      const result = await verifyAuditChain('tenant-6');
      expect(result.valid).toBe(false);
      // entry2 (newest) is first in DESC order, reversed to last
      // chain: entry1 (previousHash=null, valid), then entry2 (previousHash='wrong-hash', should be entry1.hash) — broken at index 1
      expect(result.brokenAtIndex).toBe(1);
      expect(result.brokenEntryId).toBe('2');
    });
  });
});
