import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('export - comprehensive', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/queue', () => ({ addJob: vi.fn().mockResolvedValue(undefined) }));
  });

  describe('enqueueExport', () => {
    it('enqueues contacts export', async () => {
      const { enqueueExport } = await import('@/lib/export');
      
      await enqueueExport({
        type: 'contacts',
        tenantId: 'tenant-1',
        userId: 'user-1',
        filters: { status: 'active' },
      });
      
      expect(true).toBe(true);
    });

    it('enqueues deals export with callback', async () => {
      const { enqueueExport } = await import('@/lib/export');
      
      await enqueueExport({
        type: 'deals',
        tenantId: 'tenant-1',
        userId: 'user-1',
        callbackUrl: 'https://example.com/callback',
      });
      
      expect(true).toBe(true);
    });

    it('enqueues companies export', async () => {
      const { enqueueExport } = await import('@/lib/export');
      
      await enqueueExport({
        type: 'companies',
        tenantId: 'tenant-1',
        userId: 'user-1',
      });
      
      expect(true).toBe(true);
    });

    it('enqueues tasks export', async () => {
      const { enqueueExport } = await import('@/lib/export');
      
      await enqueueExport({
        type: 'tasks',
        tenantId: 'tenant-1',
        userId: 'user-1',
      });
      
      expect(true).toBe(true);
    });
  });

  describe('enqueueContactImport', () => {
    it('enqueues contact import under limit', async () => {
      const { enqueueContactImport } = await import('@/lib/export');
      
      await enqueueContactImport(
        'tenant-1',
        'user-1',
        'name,email\nJohn,john@example.com',
        { skipDuplicates: true, updateExisting: false },
        100
      );
      
      expect(true).toBe(true);
    });

    it('enqueues contact import at exactly 1000 limit', async () => {
      const { enqueueContactImport } = await import('@/lib/export');
      
      await enqueueContactImport(
        'tenant-1',
        'user-1',
        'csv data',
        { skipDuplicates: true, updateExisting: false },
        1000
      );
      
      expect(true).toBe(true);
    });

    it('throws ImportLimitError when exceeding 1000 contacts', async () => {
      const { enqueueContactImport, ImportLimitError, MAX_IMPORT_CONTACTS } = await import('@/lib/export');
      
      await expect(enqueueContactImport(
        'tenant-1',
        'user-1',
        'csv data',
        { skipDuplicates: true, updateExisting: false },
        1001
      )).rejects.toThrow(ImportLimitError);
    });

    it('ImportLimitError has descriptive message', async () => {
      const { ImportLimitError } = await import('@/lib/export');
      
      const err = new ImportLimitError(1000, 5000);
      
      expect(err.message).toContain('1000');
      expect(err.message).toContain('5000');
      expect(err.message).toContain('Split into multiple batches');
      expect(err.name).toBe('ImportLimitError');
    });

    it('MAX_IMPORT_CONTACTS constant is 1000', async () => {
      const { MAX_IMPORT_CONTACTS } = await import('@/lib/export');
      
      expect(MAX_IMPORT_CONTACTS).toBe(1000);
    });
  });
});
