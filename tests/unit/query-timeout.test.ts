import { describe, it, expect } from 'vitest';
import { withTimeout, QueryTimeoutError } from '@/lib/db/query-timeout';

describe('withTimeout', () => {
  it('returns result for fast queries', async () => {
    const result = await withTimeout(
      () => Promise.resolve('fast'),
      { timeoutMs: 1000, operation: 'test' }
    );
    expect(result).toBe('fast');
  });

  it('throws QueryTimeoutError for slow queries', async () => {
    await expect(
      withTimeout(
        () => new Promise(resolve => setTimeout(resolve, 200)),
        { timeoutMs: 50, operation: 'slow-query' }
      )
    ).rejects.toThrow(QueryTimeoutError);
  });

  it('includes operation name in error', async () => {
    try {
      await withTimeout(
        () => new Promise(resolve => setTimeout(resolve, 200)),
        { timeoutMs: 50, operation: 'contacts.list' }
      );
    } catch (err) {
      expect(err).toBeInstanceOf(QueryTimeoutError);
      expect((err as QueryTimeoutError).operation).toBe('contacts.list');
      expect((err as QueryTimeoutError).timeoutMs).toBe(50);
    }
  });

  it('propagates errors from the query function', async () => {
    await expect(
      withTimeout(
        () => Promise.reject(new Error('DB connection failed')),
        { timeoutMs: 5000, operation: 'test' }
      )
    ).rejects.toThrow('DB connection failed');
  });

  it('uses default 30s timeout if not specified', async () => {
    const result = await withTimeout(() => Promise.resolve(42));
    expect(result).toBe(42);
  });
});
