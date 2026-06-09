import { describe, it, expect, vi } from 'vitest';
import { withRetry, withExponentialBackoff, CircuitBreaker } from '@/lib/retry';

describe('withRetry', () => {
  it('resolves on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { maxRetries: 3, initialDelay: 10 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toEqual({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    await expect(withRetry(fn, { maxRetries: 3, initialDelay: 10 })).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on ECONNRESET', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).resolves.toBe('ok');
  });

  it('retries on ETIMEDOUT', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).resolves.toBe('ok');
  });

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');
    await withRetry(fn, { maxRetries: 2, initialDelay: 10, onRetry });
    expect(onRetry).toHaveBeenCalledWith(1, { status: 503 });
  });
});

describe('withExponentialBackoff', () => {
  it('resolves on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withExponentialBackoff(fn, 'test')).resolves.toBe('ok');
  });

  it('retries on 503', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 503, message: 'down' })
      .mockResolvedValue('ok');
    await expect(withExponentialBackoff(fn, 'test')).resolves.toBe('ok');
  });
});

describe('CircuitBreaker', () => {
  it('allows execution when closed', async () => {
    const cb = new CircuitBreaker(3, 1000);
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('opens after threshold failures', async () => {
    const cb = new CircuitBreaker(2, 10000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(fn)).rejects.toThrow('fail');
    await expect(cb.execute(fn)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');
  });

  it('rejects when open', async () => {
    const cb = new CircuitBreaker(1, 60000);
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow('Circuit breaker is open');
  });

  it('transitions to half-open after timeout', async () => {
    const cb = new CircuitBreaker(1, 100);
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');
    await new Promise(r => setTimeout(r, 150));
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('resets on successful half-open execution', async () => {
    const cb = new CircuitBreaker(1, 100);
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await new Promise(r => setTimeout(r, 150));
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('can be manually reset', () => {
    const cb = new CircuitBreaker(1, 1000);
    cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    cb.reset();
    expect(cb.getState()).toBe('closed');
  });
});
