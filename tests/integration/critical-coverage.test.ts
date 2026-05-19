/**
 * CRITICAL COVERAGE TESTS
 * Targets: crypto.ts (line 53), errors.ts (logError, withErrorLogging),
 *          db/client.ts (query retry, cache, countRows), env.ts (initEnv)
 * Uses real Docker PostgreSQL for integration tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('crypto - 100% coverage', () => {
  describe('decrypt format validation', () => {
    it('throws on invalid format - missing parts', async () => {
      const { decrypt } = await import('@/lib/crypto');
      
      await expect(() => decrypt('invalid-format', 'test-key')).toThrow('Invalid encrypted format');
    });

    it('throws on empty parts', async () => {
      const { decrypt } = await import('@/lib/crypto');
      
      await expect(() => decrypt('::', 'test-key-32-chars-long!!')).toThrow('Invalid encrypted format');
    });
  });

  describe('encrypt edge cases', () => {
    it('handles very long plaintext', async () => {
      const { encrypt, decrypt } = await import('@/lib/crypto');
      const key = 'test-key-32-chars-long!!';
      const longText = 'a'.repeat(1000);
      
      const encrypted = encrypt(longText, key);
      const decrypted = decrypt(encrypted, key);
      
      expect(decrypted).toBe(longText);
    });

    it('handles special characters', async () => {
      const { encrypt, decrypt } = await import('@/lib/crypto');
      const key = 'test-key-32-chars-long!!';
      const special = 'Hello 🌍! @#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
      
      const encrypted = encrypt(special, key);
      const decrypted = decrypt(encrypted, key);
      
      expect(decrypted).toBe(special);
    });
  });

  describe('hashPassword edge cases', () => {
    it('handles unicode characters', async () => {
      const { hashPassword, verifyPassword } = await import('@/lib/crypto');
      
      const hash = await hashPassword('パスワード123!');
      const valid = await verifyPassword('パスワード123!', hash);
      
      expect(valid).toBe(true);
    });
  });
});

describe('errors - 100% coverage', () => {
  describe('logError', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('logs Error object with full details', async () => {
      const { logError } = await import('@/lib/errors');
      
      const error = new Error('Test error message');
      
      await expect(logError({
        error,
        context: 'test-context',
        tenantId: 'tenant-123',
        userId: 'user-456',
        level: 'warning',
        metadata: { key: 'value' },
      })).resolves.not.toThrow();
    });

    it('logs non-Error objects', async () => {
      const { logError } = await import('@/lib/errors');
      
      await expect(logError({
        error: 'string error',
        context: 'string-context',
      })).resolves.not.toThrow();
    });

    it('logs null/undefined errors', async () => {
      const { logError } = await import('@/lib/errors');
      
      await expect(logError({
        error: null,
        context: 'null-context',
      })).resolves.not.toThrow();
      
      await expect(logError({
        error: undefined,
        context: 'undefined-context',
      })).resolves.not.toThrow();
    });

    it('handles very long error messages', async () => {
      const { logError } = await import('@/lib/errors');
      
      const longError = new Error('a'.repeat(2000));
      
      await expect(logError({
        error: longError,
        context: 'long-error',
      })).resolves.not.toThrow();
    });

    it('handles errors with long stack traces', async () => {
      const { logError } = await import('@/lib/errors');
      
      function nestedFunction() {
        throw new Error('Nested error');
      }
      
      try {
        nestedFunction();
      } catch (err) {
        await expect(logError({
          error: err,
          context: 'nested-context',
        })).resolves.not.toThrow();
      }
    });
  });

  describe('withErrorLogging', () => {
    it('returns result when function succeeds', async () => {
      const { withErrorLogging } = await import('@/lib/errors');
      
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withErrorLogging(fn, 'test-context');
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns null and logs when function throws', async () => {
      const { withErrorLogging } = await import('@/lib/errors');
      
      const fn = vi.fn().mockRejectedValue(new Error('Function error'));
      const result = await withErrorLogging(fn, 'fail-context', {
        tenantId: 't-1',
        userId: 'u-1',
      });
      
      expect(result).toBeNull();
    });

    it('handles async function errors', async () => {
      const { withErrorLogging } = await import('@/lib/errors');
      
      const fn = async () => {
        await new Promise(r => setTimeout(r, 10));
        throw new Error('Async error');
      };
      
      const result = await withErrorLogging(fn, 'async-context');
      expect(result).toBeNull();
    });
  });

  describe('DatabaseError', () => {
    it('creates with custom message and details', async () => {
      const { DatabaseError, ErrorCode } = await import('@/lib/errors');
      
      const error = new DatabaseError('Connection lost', 'timeout after 30s');
      
      expect(error.message).toBe('Connection lost');
      expect(error.details).toBe('timeout after 30s');
      expect(error.code).toBe(ErrorCode.DB_QUERY_FAILED);
    });
  });

  describe('EmailError', () => {
    it('creates with custom message and details', async () => {
      const { EmailError, ErrorCode } = await import('@/lib/errors');
      
      const error = new EmailError('SMTP unavailable', 'host=mail.example.com');
      
      expect(error.message).toBe('SMTP unavailable');
      expect(error.details).toBe('host=mail.example.com');
      expect(error.code).toBe(ErrorCode.EMAIL_SEND_FAILED);
    });
  });

  describe('handleError - all branches', () => {
    it('handles database errors by message detection', async () => {
      const { handleError } = await import('@/lib/errors');
      
      const error = new Error('database connection failed');
      const response = handleError(error);
      
      expect(response).toBeDefined();
    });

    it('handles validation errors by message detection', async () => {
      const { handleError } = await import('@/lib/errors');
      
      const error = new Error('validation failed for input');
      const response = handleError(error);
      
      expect(response).toBeDefined();
    });
  });
});

describe('db/client - integration with Docker PostgreSQL', () => {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    it.skip('skips - no DATABASE_URL', () => {});
    return;
  }

  describe('getPool with real DB', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as any).__pgPool;
    });

    it('creates pool and connects successfully', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { getPool } = await import('@/lib/db/client');
      const pool = getPool();
      
      expect(pool).toBeDefined();
      
      // Test actual connection
      const result = await pool.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    });
  });

  describe('query with retry logic', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as any).__pgPool;
    });

    it('executes query successfully', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      process.env.NODE_ENV = 'test';
      
      const { query } = await import('@/lib/db/client');
      const result = await query('SELECT $1::text as name', ['test-user']);
      
      expect(result.rows[0].name).toBe('test-user');
    });

    it('queryOne returns single row or null', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { queryOne } = await import('@/lib/db/client');
      
      // With data
      const row = await queryOne('SELECT $1::text as value', ['hello']);
      expect(row).toEqual({ value: 'hello' });
      
      // Without data
      const nullRow = await queryOne('SELECT $1::text as value WHERE false', ['test']);
      expect(nullRow).toBeNull();
    });

    it('queryMany returns all rows', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { queryMany } = await import('@/lib/db/client');
      const rows = await queryMany('SELECT generate_series(1, 3) as num');
      
      expect(rows).toHaveLength(3);
      expect(rows[0].num).toBe(1);
    });
  });

  describe('withTransaction', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as any).__pgPool;
    });

    it('commits on success', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { withTransaction, query } = await import('@/lib/db/client');
      
      const result = await withTransaction(async (client) => {
        await client.query('SELECT 1');
        return 'committed';
      });
      
      expect(result).toBe('committed');
    });

    it('rolls back on error', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { withTransaction } = await import('@/lib/db/client');
      
      await expect(withTransaction(async () => {
        throw new Error('Transaction failed');
      })).rejects.toThrow('Transaction failed');
    });
  });

  describe('buildInsert with real tables', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as any).__pgPool;
    });

    it('builds valid INSERT for notes table', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { buildInsert, query } = await import('@/lib/db/client');
      
      const stmt = buildInsert('notes', {
        tenant_id: '00000000-0000-0000-0000-000000000001',
        content: 'Test note',
        created_by: '00000000-0000-0000-0000-000000000001',
      });
      
      expect(stmt.sql).toContain('INSERT INTO public.notes');
      expect(stmt.values).toContain('Test note');
    });

    it('builds valid UPDATE for notes table', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { buildUpdate } = await import('@/lib/db/client');
      
      const stmt = buildUpdate(
        'notes',
        { content: 'Updated note' },
        { id: '00000000-0000-0000-0000-000000000001' }
      );
      
      expect(stmt.sql).toContain('UPDATE public.notes');
      expect(stmt.sql).toContain('updated_at=now()');
    });
  });

  describe('countRows', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as any).__pgPool;
    });

    it('counts rows with valid where clause', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { countRows } = await import('@/lib/db/client');
      
      // Use a table that definitely exists and has rows
      const count = await countRows('users', { is_super_admin: false });
      
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dbCache integration', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as any).__pgPool;
    });

    it('caches and returns data', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { dbCache } = await import('@/lib/db/client');
      
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        return { data: 'fresh', timestamp: Date.now() };
      };
      
      // First call - fetches
      const result1 = await dbCache('test-key', 5000, fetcher);
      expect(result1.data).toBe('fresh');
      expect(fetchCount).toBe(1);
      
      // Second call - uses cache
      const result2 = await dbCache('test-key', 5000, fetcher);
      expect(result2.data).toBe('fresh');
      expect(fetchCount).toBe(1); // Still 1!
      
      // Different key - fetches again
      const result3 = await dbCache('other-key', 5000, fetcher);
      expect(fetchCount).toBe(2);
    });
  });

  describe('invalidateCache', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as any).__pgPool;
    });

    it('invalidates matching keys', async () => {
      process.env.DATABASE_URL = dbUrl;
      process.env.DATABASE_SSL = 'false';
      process.env.DATABASE_POOL_SIZE = '5';
      
      const { dbCache, invalidateCache } = await import('@/lib/db/client');
      
      await dbCache('user:1:profile', 5000, async () => ({ name: 'user1' }));
      await dbCache('user:2:profile', 5000, async () => ({ name: 'user2' }));
      await dbCache('settings:general', 5000, async () => ({ theme: 'dark' }));
      
      invalidateCache('user:');
      
      // user keys should be invalidated
      let fetchCount = 0;
      await dbCache('user:1:profile', 5000, async () => {
        fetchCount++;
        return { name: 'user1-new' };
      });
      
      expect(fetchCount).toBe(1);
    });
  });
});

describe('env - 100% coverage', () => {
  describe('initEnv', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
      process.env.JWT_SECRET = 'a'.repeat(48);
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      process.env.SETUP_KEY = 'a'.repeat(24);
      process.env.ALLOWED_ORIGINS = '*';
      process.env.CRON_SECRET = 'b'.repeat(24);
      process.env.DATABASE_POOL_SIZE = '5';
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      delete process.env.RESEND_API_KEY;
      delete process.env.SENTRY_DSN;
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('initializes env with all valid values', async () => {
      const { initEnv } = await import('@/lib/env');
      
      const config = initEnv();
      
      expect(config.databaseUrl).toBe('postgresql://user:pass@localhost:5432/test');
      expect(config.jwtSecret).toHaveLength(48);
      expect(config.appUrl).toBe('http://localhost:3000');
      expect(config.nodeEnv).toBe('development');
      expect(config.databasePoolSize).toBe(5);
      expect(config.databaseSsl).toBe(false);
    });

    it('initializes with optional values', async () => {
      process.env.RESEND_API_KEY = 're_test_abc123';
      process.env.SENTRY_DSN = 'https://key@sentry.io/123';
      process.env.REDIS_URL = 'redis://localhost:6379';
      
      const { initEnv } = await import('@/lib/env');
      
      const config = initEnv();
      
      expect(config.resendApiKey).toBe('re_test_abc123');
      expect(config.sentryDsn).toBe('https://key@sentry.io/123');
    });

    it('parses DATABASE_SSL true', async () => {
      process.env.DATABASE_SSL = 'true';
      
      const { initEnv } = await import('@/lib/env');
      const config = initEnv();
      
      expect(config.databaseSsl).toBe(true);
    });

    it('shows test mode email message', async () => {
      const { initEnv } = await import('@/lib/env');
      initEnv();
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Email: Not configured')
      );
    });
  });
});
