import { describe, it, expect, vi } from 'vitest';
import { withRetry, isTransientError } from '@/lib/db/retry';

describe('isTransientError', () => {
  it('returns true for deadlock error code', () => {
    expect(isTransientError({ code: '40P01', message: 'deadlock detected' })).toBe(true);
  });

  it('returns true for serialization failure', () => {
    expect(isTransientError({ code: '40001', message: 'could not serialize access' })).toBe(true);
  });

  it('returns true for connection errors by message', () => {
    expect(isTransientError({ message: 'connection terminated unexpectedly' })).toBe(true);
    expect(isTransientError({ message: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ message: 'socket hang up' })).toBe(true);
  });

  it('returns false for constraint violations', () => {
    expect(isTransientError({ code: '23505', message: 'unique violation' })).toBe(false);
  });

  it('returns false for syntax errors', () => {
    expect(isTransientError({ code: '42601', message: 'syntax error' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: '40P01', message: 'deadlock' })
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, { baseDelayMs: 10, maxRetries: 3, maxDelayMs: 50 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue({ code: '23505', message: 'unique violation' });

    await expect(withRetry(fn, { baseDelayMs: 10, maxRetries: 3, maxDelayMs: 50 }))
      .rejects.toMatchObject({ code: '23505' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue({ code: '40P01', message: 'deadlock' });

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 }))
      .rejects.toMatchObject({ code: '40P01' });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('applies exponential backoff', async () => {
    const start = Date.now();
    const fn = vi.fn()
      .mockRejectedValueOnce({ message: 'ECONNRESET' })
      .mockRejectedValueOnce({ message: 'ECONNRESET' })
      .mockResolvedValueOnce('ok');

    await withRetry(fn, { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 500 });
    const elapsed = Date.now() - start;
    // First retry: ~50ms, second: ~100ms = ~150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });
});
