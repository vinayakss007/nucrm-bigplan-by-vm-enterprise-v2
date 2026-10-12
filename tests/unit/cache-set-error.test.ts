import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Cache Module - Set Error Path', () => {
  const originalEnv = process.env;

  const mockRedis = {
    status: 'ready',
    on: vi.fn(),
    setex: vi.fn(),
    get: vi.fn(),
    ping: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, REDIS_URL: 'redis://localhost:6379' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.doMock('ioredis', () => ({
      Redis: class {
        status = mockRedis.status;
        on = mockRedis.on;
        setex = mockRedis.setex;
        get = mockRedis.get;
        ping = mockRedis.ping;
      },
    }));

    mockRedis.setex.mockReset();
    mockRedis.get.mockReset();
    mockRedis.ping.mockReset();
    mockRedis.status = 'ready';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock('ioredis');
    vi.restoreAllMocks();
  });

  it('falls back to memory cache on Redis setex error', async () => {
    const { cache, _resetCircuitBreaker, _getCircuitState } = await import('@/lib/cache');
    _resetCircuitBreaker();

    mockRedis.setex.mockRejectedValue(new Error('Redis is down during setex'));

    await cache.set('test-error-key', { foo: 'bar' }, 60);

    // Assert setex was attempted
    expect(mockRedis.setex).toHaveBeenCalledWith('nucrm:test-error-key', 60, JSON.stringify({ foo: 'bar' }));

    // Assert error was logged
    expect(console.error).toHaveBeenCalledWith('[Cache] Set error:', expect.any(Error));

    // Assert circuit breaker recorded the failure
    const state = _getCircuitState();
    expect(state.failures).toBe(1);

    // Check that it's in the memory cache
    // We can verify this by making redis.get fail or just be empty,
    // and seeing if cache.get retrieves the value from the fallback.
    // However, cache.get also does a redis.get which we'll mock to fail so it falls back to memory.
    mockRedis.get.mockRejectedValue(new Error('Redis is down during get'));

    const val = await cache.get('test-error-key');
    expect(val).toEqual({ foo: 'bar' });
  });
});
