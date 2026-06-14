import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: mockExecute,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
