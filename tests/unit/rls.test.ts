import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle db
vi.mock('@/drizzle/db', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
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
      const { query } = await import('@/lib/db/client');
      
      await setTenantContext('tenant-123', 'user-456');
      
      expect(query).toHaveBeenCalledWith(
        'SELECT set_config($1, $2, true), set_config($3, $4, true)',
        ['app.current_tenant', 'tenant-123', 'app.current_user', 'user-456']
      );
    });

    it('throws on database error', async () => {
      const { query } = await import('@/lib/db/client');
      vi.mocked(query).mockRejectedValueOnce(new Error('DB error'));
      
      const { setTenantContext } = await import('@/lib/db/rls');
      
      await expect(setTenantContext('tenant-123', 'user-456')).rejects.toThrow('DB error');
    });
  });

  describe('clearTenantContext', () => {
    it('clears tenant context by setting empty values', async () => {
      const { clearTenantContext } = await import('@/lib/db/rls');
      const { query } = await import('@/lib/db/client');
      
      await clearTenantContext();
      
      expect(query).toHaveBeenCalledWith(
        'SELECT set_config($1, $2, true), set_config($3, $4, true)',
        ['app.current_tenant', '', 'app.current_user', '']
      );
    });

    it('does not throw on error', async () => {
      const { query } = await import('@/lib/db/client');
      vi.mocked(query).mockRejectedValueOnce(new Error('DB error'));
      
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

  describe('queryWithTenantContext', () => {
    it('executes query with tenant context', async () => {
      const { queryWithTenantContext } = await import('@/lib/db/rls');
      
      const queryFn = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
      const result = await queryWithTenantContext('tenant-123', 'user-456', queryFn);
      
      expect(result).toEqual({ rows: [{ id: 1 }] });
      expect(queryFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyRLSEnabled', () => {
    it('returns true when RLS is enabled', async () => {
      const { query } = await import('@/lib/db/client');
      vi.mocked(query).mockResolvedValueOnce({ 
        rows: [{ rowsecurity: true }] 
      });
      
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      
      expect(result).toBe(true);
    });

    it('returns false when RLS is not enabled', async () => {
      const { query } = await import('@/lib/db/client');
      vi.mocked(query).mockResolvedValueOnce({ 
        rows: [{ rowsecurity: false }] 
      });
      
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      const { query } = await import('@/lib/db/client');
      vi.mocked(query).mockRejectedValueOnce(new Error('DB error'));
      
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      
      expect(result).toBe(false);
    });
  });

  describe('verifyAllRLSEnabled', () => {
    it('checks all critical tables', async () => {
      const { query } = await import('@/lib/db/client');
      vi.mocked(query).mockResolvedValue({ 
        rows: [{ rowsecurity: true }] 
      });
      
      const { verifyAllRLSEnabled } = await import('@/lib/db/rls');
      const results = await verifyAllRLSEnabled();
      
      expect(results).toHaveLength(12); // 12 critical tables
      expect(results[0]).toHaveProperty('table');
      expect(results[0]).toHaveProperty('enabled');
    });
  });
});
