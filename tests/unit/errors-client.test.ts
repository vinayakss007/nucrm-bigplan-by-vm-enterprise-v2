import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError, withErrorLogging } from '@/lib/errors-client';

describe('logError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs error with context', async () => {
    await logError({ error: new Error('test error'), context: 'test' });
    expect(console.error).toHaveBeenCalledWith(
      '[logError] test',
      expect.any(Error)
    );
  });

  it('logs error without context', async () => {
    await logError({ error: 'string error' });
    expect(console.error).toHaveBeenCalledWith(
      '[logError] ',
      'string error'
    );
  });

  it('logs error with extra metadata', async () => {
    await logError({ error: new Error('err'), context: 'ctx', userId: '123', action: 'test' });
    expect(console.error).toHaveBeenCalledWith(
      '[logError] ctx',
      expect.any(Error)
    );
  });
});

describe('withErrorLogging', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns fn result on success', async () => {
    const result = await withErrorLogging(async () => 'success', 'test');
    expect(result).toBe('success');
  });

  it('returns null and logs on error', async () => {
    const fn = async () => { throw new Error('boom'); };
    const result = await withErrorLogging(fn, 'test');
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      '[logError] test',
      expect.any(Error)
    );
  });

  it('passes metadata to logError on failure', async () => {
    const fn = async () => { throw new Error('fail'); };
    await withErrorLogging(fn, 'ctx', { userId: 'u1' });
    expect(console.error).toHaveBeenCalledWith(
      '[logError] ctx',
      expect.any(Error)
    );
  });

  it('handles non-Error thrown values', async () => {
    const fn = async () => { throw 'string error'; };
    const result = await withErrorLogging(fn, 'test');
    expect(result).toBeNull();
  });
});
