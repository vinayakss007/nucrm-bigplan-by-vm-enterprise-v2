import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: mockExecute,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn(async (cb: any) => {
      const tx = { execute: vi.fn() };
      return cb(tx);
    }),
  },
}));

describe('db/rls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('setTenantContext', () => {
    it('sets tenant and user context', async () => {
      const { setTenantContext } = await import('@/lib/db/rls');
      await setTenantContext('tenant-123', 'user-456');
      expect(mockExecute).toHaveBeenCalled();
    });

    it('throws on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));
      const { setTenantContext } = await import('@/lib/db/rls');
      await expect(setTenantContext('tenant-123', 'user-456')).rejects.toThrow('DB error');
    });

    it('rejects empty tenantId', async () => {
      const { setTenantContext } = await import('@/lib/db/rls');
      await expect(setTenantContext('', 'user-456')).rejects.toThrow('empty tenantId');
    });

    it('rejects empty userId', async () => {
      const { setTenantContext } = await import('@/lib/db/rls');
      await expect(setTenantContext('tenant-123', '')).rejects.toThrow('empty tenantId or userId');
    });
  });

  describe('clearTenantContext', () => {
    it('clears tenant context by setting empty values', async () => {
      const { clearTenantContext } = await import('@/lib/db/rls');
      await clearTenantContext();
      expect(mockExecute).toHaveBeenCalled();
    });

    it('does not throw on error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));
      const { clearTenantContext } = await import('@/lib/db/rls');
      await expect(clearTenantContext()).resolves.not.toThrow();
    });
  });

  describe('withTenantContext', () => {
    it('executes function with tenant context in transaction', async () => {
      const { withTenantContext } = await import('@/lib/db/rls');
      const fn = vi.fn().mockResolvedValue({ id: 1, name: 'test' });
      const result = await withTenantContext('tenant-123', 'user-456', fn);
      expect(result).toEqual({ id: 1, name: 'test' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('rejects empty tenantId', async () => {
      const { withTenantContext } = await import('@/lib/db/rls');
      const fn = vi.fn();
      await expect(withTenantContext('', 'user-456', fn)).rejects.toThrow('empty tenantId or userId');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['security', 'app.is_super_admin'],
    ['lookup', 'app.auth_lookup'],
    ['user', 'app.current_user'],
  ] as const)('%s transaction context', (kind, guc) => {
    async function run(fn: (tx: unknown) => Promise<unknown>) {
      const rls = await import('@/lib/db/rls');
      if (kind === 'security') return rls.withSecurityContext(fn);
      if (kind === 'lookup') return rls.withAuthLookupContext(fn);
      return rls.withUserContext('user-123', fn);
    }

    it('sets transaction-local context before invoking the callback', async () => {
      const { db } = await import('@/drizzle/db');
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const tx = { execute };
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn(tx as unknown as Parameters<typeof fn>[0]));
      const callback = vi.fn(async (client) => {
        expect(client).toBe(tx);
        expect(execute).toHaveBeenCalledTimes(1);
        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
        expect(query.sql).toContain(guc);
        expect(query.sql).toContain('true)');
        return 'complete';
      });
      await expect(run(callback)).resolves.toBe('complete');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('never runs the callback when context initialization fails', async () => {
      const { db } = await import('@/drizzle/db');
      const tx = { execute: vi.fn().mockRejectedValue(new Error('context failed')) };
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn(tx as unknown as Parameters<typeof fn>[0]));
      const callback = vi.fn();
      await expect(run(callback)).rejects.toThrow('context failed');
      expect(callback).not.toHaveBeenCalled();
    });

    it('propagates callback failures to the transaction', async () => {
      const callback = vi.fn().mockRejectedValue(new Error('write failed'));
      await expect(run(callback)).rejects.toThrow('write failed');
    });
  });

  describe('verifyRLSEnabled', () => {
    it('returns true when RLS is enabled', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [{ rowsecurity: true }] });
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      expect(result).toBe(true);
    });

    it('returns false when RLS is not enabled', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [{ rowsecurity: false }] });
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      expect(result).toBe(false);
    });
  });

  describe('verifyAllRLSEnabled', () => {
    it('checks all critical tables', async () => {
      mockExecute.mockResolvedValue({ rows: [{ rowsecurity: true }] });
      const { verifyAllRLSEnabled } = await import('@/lib/db/rls');
      const results = await verifyAllRLSEnabled();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('table');
      expect(results[0]).toHaveProperty('enabled');
    });
  });
});
