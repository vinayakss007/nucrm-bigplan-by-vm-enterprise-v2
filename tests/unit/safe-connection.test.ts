import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeQuery, safeTransaction, checkDatabaseHealth, isTransientError, getCircuitBreaker } from '@/lib/db/safe-connection';
import * as poolModule from '@/lib/db/pool';

// Mock the pool module
vi.mock('@/lib/db/pool', () => ({
  getPool: vi.fn(),
}));

// Mock the logError to avoid polluting test output, and to check if it's called
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

import { logError } from '@/lib/errors-server';

describe('Safe Connection Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset circuit breaker state before each test
    const breaker = getCircuitBreaker();
    // @ts-ignore - access private properties for testing reset
    breaker.failures = 0;
    // @ts-ignore
    breaker.state = 'CLOSED';
    // @ts-ignore
    breaker.nextAttempt = Date.now();
  });

  describe('isTransientError', () => {
    it('returns true for known transient PG error codes', () => {
      expect(isTransientError({ code: '40P01' })).toBe(true); // deadlock
      expect(isTransientError({ code: '40001' })).toBe(true); // serialization failure
    });

    it('returns true for Node network errors', () => {
      expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
      expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    });

    it('returns true for transient connection messages', () => {
      expect(isTransientError({ message: 'connection terminated unexpectedly' })).toBe(true);
      expect(isTransientError({ message: 'cannot connect now' })).toBe(true);
    });

    it('returns false for non-retryable PG error classes', () => {
      expect(isTransientError({ code: '23505' })).toBe(false); // unique_violation
      expect(isTransientError({ code: '42P01' })).toBe(false); // undefined_table
    });

    it('returns false for unknown errors or non-objects', () => {
      expect(isTransientError(new Error('Unknown error'))).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
      expect(isTransientError('string error')).toBe(false);
    });
  });

  describe('safeQuery', () => {
    it('executes a query successfully', async () => {
      const mockResult = { rows: [{ id: 1 }] };
      const mockQuery = vi.fn().mockResolvedValue(mockResult);
      vi.mocked(poolModule.getPool).mockReturnValue({ query: mockQuery } as any);

      const result = await safeQuery('SELECT 1');

      expect(result).toBe(mockResult);
      expect(mockQuery).toHaveBeenCalledWith('SELECT 1', undefined);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('retries on transient error and succeeds', async () => {
      const mockResult = { rows: [{ id: 1 }] };
      const transientError = new Error('connection terminated');
      // @ts-ignore
      transientError.code = 'ECONNRESET';

      const mockQuery = vi.fn()
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(mockResult);

      vi.mocked(poolModule.getPool).mockReturnValue({ query: mockQuery } as any);

      const result = await safeQuery('SELECT 1', [], { initialDelayMs: 1 });

      expect(result).toBe(mockResult);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('fails immediately on non-transient error', async () => {
      const nonTransientError = new Error('Syntax error');
      // @ts-ignore
      nonTransientError.code = '42601'; // syntax_error

      const mockQuery = vi.fn().mockRejectedValue(nonTransientError);
      vi.mocked(poolModule.getPool).mockReturnValue({ query: mockQuery } as any);

      await expect(safeQuery('SELECT 1')).rejects.toThrow('Syntax error');
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('throws after max retries are exceeded', async () => {
      const transientError = new Error('Connection timeout');
      // @ts-ignore
      transientError.code = 'ETIMEDOUT';

      const mockQuery = vi.fn().mockRejectedValue(transientError);
      vi.mocked(poolModule.getPool).mockReturnValue({ query: mockQuery } as any);

      const maxRetries = 2;
      await expect(safeQuery('SELECT 1', [], { maxRetries, initialDelayMs: 1 }))
        .rejects.toThrow('Connection timeout');

      expect(mockQuery).toHaveBeenCalledTimes(maxRetries + 1); // initial attempt + retries
      expect(logError).toHaveBeenCalledTimes(1); // Only logged on final failure
    });
  });

  describe('safeTransaction', () => {
    it('executes a transaction successfully', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({}),
        release: vi.fn(),
      };
      vi.mocked(poolModule.getPool).mockReturnValue({
        connect: vi.fn().mockResolvedValue(mockClient)
      } as any);

      const work = vi.fn().mockResolvedValue('success');
      const result = await safeTransaction(work);

      expect(result).toBe('success');
      expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(work).toHaveBeenCalledWith(mockClient);
      expect(mockClient.query).toHaveBeenNthCalledWith(2, 'COMMIT');
      expect(mockClient.release).toHaveBeenCalledWith(undefined);
    });

    it('rolls back on error and retries if transient', async () => {
      const transientError = new Error('deadlock detected');
      // @ts-ignore
      transientError.code = '40P01';

      const mockClient1 = {
        query: vi.fn().mockImplementation((q) => {
          if (q === 'BEGIN') return Promise.resolve();
          return Promise.reject(transientError);
        }),
        release: vi.fn(),
      };

      const mockClient2 = {
        query: vi.fn().mockResolvedValue({}),
        release: vi.fn(),
      };

      const connectMock = vi.fn()
        .mockResolvedValueOnce(mockClient1)
        .mockResolvedValueOnce(mockClient2);

      vi.mocked(poolModule.getPool).mockReturnValue({ connect: connectMock } as any);

      const work = vi.fn()
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce('success');

      const result = await safeTransaction(work, { initialDelayMs: 1 });

      expect(result).toBe('success');
      expect(connectMock).toHaveBeenCalledTimes(2);
      expect(work).toHaveBeenCalledTimes(2);
      expect(mockClient1.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient1.release).toHaveBeenCalledWith(true); // released with error flag
      expect(mockClient2.query).toHaveBeenCalledWith('COMMIT');
    });

    it('fails immediately on non-transient error in transaction', async () => {
      const nonTransientError = new Error('Constraint violation');
      // @ts-ignore
      nonTransientError.code = '23505';

      const mockClient = {
        query: vi.fn().mockResolvedValue({}),
        release: vi.fn(),
      };

      vi.mocked(poolModule.getPool).mockReturnValue({
        connect: vi.fn().mockResolvedValue(mockClient)
      } as any);

      const work = vi.fn().mockRejectedValue(nonTransientError);

      await expect(safeTransaction(work)).rejects.toThrow('Constraint violation');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledWith(true);
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkDatabaseHealth', () => {
    it('returns healthy status when query succeeds', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({}),
        totalCount: 5,
        idleCount: 2,
        waitingCount: 0,
      };
      vi.mocked(poolModule.getPool).mockReturnValue(mockPool as any);

      const health = await checkDatabaseHealth();

      expect(health.healthy).toBe(true);
      expect(health.reachable).toBe(true);
      expect(health.poolStats).toEqual({ totalCount: 5, idleCount: 2, waitingCount: 0 });
      expect(typeof health.latencyMs).toBe('number');
    });

    it('returns unhealthy status when query fails', async () => {
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };
      vi.mocked(poolModule.getPool).mockReturnValue(mockPool as any);

      const health = await checkDatabaseHealth();

      expect(health.healthy).toBe(false);
      expect(health.reachable).toBe(false);
      expect(health.error).toBe('Connection failed');
    });
  });

  describe('getCircuitBreaker', () => {
    it('returns the circuit breaker instance', () => {
      const breaker = getCircuitBreaker();
      expect(breaker).toBeDefined();
      expect(typeof breaker.execute).toBe('function');
    });
  });
});
