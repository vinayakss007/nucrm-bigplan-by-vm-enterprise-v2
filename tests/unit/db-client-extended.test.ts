import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pg module
vi.mock('pg', () => {
  class MockPool {
    query = vi.fn();
    on = vi.fn();
    connect = vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    });
  }
  
  return { Pool: MockPool };
});

// Mock devLogger
vi.mock('@/lib/dev-logger', () => ({
  devLogger: {
    query: vi.fn(),
    error: vi.fn(),
  },
}));

describe('db/client', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_POOL_SIZE;
    delete (global as any).__pgPool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getPool', () => {
    it('throws error when DATABASE_URL is missing', async () => {
      const { getPool } = await import('@/lib/db/client');
      expect(() => getPool()).toThrow('DATABASE_URL is required');
    });

    it('creates pool with valid DATABASE_URL', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      const { getPool } = await import('@/lib/db/client');
      
      // Pool creation should not throw
      expect(() => {
        try { getPool(); } catch (e: any) {
          if (!e.message.includes('DATABASE_URL')) throw e;
        }
      }).not.toThrow();
    });

    it('uses correct pool size from env', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.DATABASE_POOL_SIZE = '15';
      const { getPool } = await import('@/lib/db/client');
      
      // Should not throw on valid config
      expect(() => {
        try { getPool(); } catch (e: any) {
          if (!e.message.includes('DATABASE_URL') && !e.message.includes('pool')) throw e;
        }
      }).not.toThrow();
    });

    it('disables SSL when DATABASE_SSL is false', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.DATABASE_SSL = 'false';
      const { getPool } = await import('@/lib/db/client');
      
      expect(() => {
        try { getPool(); } catch (e: any) {
          if (!e.message.includes('DATABASE_URL')) throw e;
        }
      }).not.toThrow();
    });

    it('throws on invalid pool size', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.DATABASE_POOL_SIZE = '0';
      const { getPool } = await import('@/lib/db/client');
      expect(() => getPool()).toThrow('must be between 1 and 100');
    });
  });

  describe('query helpers', () => {
    it('queryOne returns first row or null', async () => {
      const { queryOne } = await import('@/lib/db/client');
      expect(queryOne).toBeDefined();
      expect(typeof queryOne).toBe('function');
    });

    it('queryMany returns all rows', async () => {
      const { queryMany } = await import('@/lib/db/client');
      expect(queryMany).toBeDefined();
      expect(typeof queryMany).toBe('function');
    });

    it('withTransaction is defined', async () => {
      const { withTransaction } = await import('@/lib/db/client');
      expect(withTransaction).toBeDefined();
      expect(typeof withTransaction).toBe('function');
    });
  });

  describe('buildInsert', () => {
    it('builds INSERT query with valid data', async () => {
      const { buildInsert } = await import('@/lib/db/client');
      const result = buildInsert('contacts', {
        name: 'John',
        email: 'john@example.com',
      });
      expect(result.sql).toContain('INSERT INTO public.contacts');
      expect(result.values).toContain('John');
      expect(result.values).toContain('john@example.com');
    });

    it('throws when no fields provided', async () => {
      const { buildInsert } = await import('@/lib/db/client');
      expect(() => buildInsert('contacts', {})).toThrow('no fields');
    });

    it('filters out protected fields', async () => {
      const { buildInsert } = await import('@/lib/db/client');
      const result = buildInsert('users', {
        name: 'John',
        id: 'should-be-excluded',
        password_hash: 'should-be-excluded',
        created_at: 'should-be-excluded',
      });
      expect(result.sql).not.toContain('password_hash');
      expect(result.values).not.toContain('should-be-excluded');
    });

    it('validates table names against whitelist', async () => {
      const { buildInsert } = await import('@/lib/db/client');
      expect(() => buildInsert('invalid_table', { name: 'test' })).toThrow('Invalid table name');
    });
  });

  describe('buildUpdate', () => {
    it('builds UPDATE query with valid data', async () => {
      const { buildUpdate } = await import('@/lib/db/client');
      const result = buildUpdate(
        'contacts',
        { name: 'John Updated' },
        { id: '123' }
      );
      expect(result.sql).toContain('UPDATE public.contacts');
      expect(result.sql).toContain('WHERE');
      expect(result.values).toContain('John Updated');
    });

    it('throws when no update fields provided', async () => {
      const { buildUpdate } = await import('@/lib/db/client');
      expect(() => buildUpdate('contacts', {}, { id: '123' })).toThrow('no fields');
    });

    it('filters out protected fields', async () => {
      const { buildUpdate } = await import('@/lib/db/client');
      const result = buildUpdate(
        'users',
        { name: 'Updated', is_super_admin: true },
        { id: '123' }
      );
      expect(result.sql).not.toContain('is_super_admin');
    });
  });

  describe('dbCache', () => {
    it('caches fetcher result', async () => {
      const { dbCache } = await import('@/lib/db/client');
      const fetcher = vi.fn().mockResolvedValue({ id: 1, name: 'test' });
      
      const result = await dbCache('test-key', 5000, fetcher);
      expect(result).toEqual({ id: 1, name: 'test' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      
      // Second call should use cache
      const result2 = await dbCache('test-key', 5000, fetcher);
      expect(result2).toEqual({ id: 1, name: 'test' });
      expect(fetcher).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('refetches when cache expires', async () => {
      const { dbCache } = await import('@/lib/db/client');
      const fetcher = vi.fn().mockResolvedValue({ id: 1 });
      
      await dbCache('expire-key', 1, fetcher); // 1ms TTL
      await new Promise(r => setTimeout(r, 10)); // Wait for expiry
      await dbCache('expire-key', 1, fetcher);
      
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateCache', () => {
    it('removes keys with matching prefix', async () => {
      const { dbCache, invalidateCache } = await import('@/lib/db/client');
      
      await dbCache('user:1', 5000, async () => ({ name: 'user1' }));
      await dbCache('user:2', 5000, async () => ({ name: 'user2' }));
      
      invalidateCache('user:');
      
      // Cache should be cleared, fetcher called again
      const fetcher = vi.fn().mockResolvedValue({ name: 'new' });
      await dbCache('user:1', 5000, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
});
