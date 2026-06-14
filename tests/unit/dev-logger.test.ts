import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('console', {
    log: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
    time: vi.fn(),
    timeEnd: vi.fn(),
    clear: vi.fn(),
  });
  vi.stubGlobal('process', { ...process, env: { ...process.env } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function getDevLogger(devMode = true) {
  process.env.NODE_ENV = devMode ? 'development' : 'production';
  const mod = await import('@/lib/dev-logger');
  return mod.devLogger;
}

describe('log', () => {
  it('logs in development mode', async () => {
    const logger = await getDevLogger(true);
    logger.log('test message', 'info');
    expect(console.log).toHaveBeenCalled();
  });

  it('does not log in production mode', async () => {
    const logger = await getDevLogger(false);
    logger.log('prod message', 'info');
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('request', () => {
  it('logs successful requests in development', async () => {
    const logger = await getDevLogger(true);
    logger.request('GET', '/api/test', 200, 50);
    expect(console.log).toHaveBeenCalled();
  });

  it('logs 4xx as warnings', async () => {
    const logger = await getDevLogger(true);
    logger.request('POST', '/api/test', 404, 30);
    expect(console.log).toHaveBeenCalled();
  });

  it('logs 5xx as errors', async () => {
    const logger = await getDevLogger(true);
    logger.request('DELETE', '/api/test', 500, 100);
    expect(console.log).toHaveBeenCalled();
  });

  it('includes ip and userId', async () => {
    const logger = await getDevLogger(true);
    logger.request('GET', '/api/test', 200, 10, '127.0.0.1', 'u1');
    expect(console.log).toHaveBeenCalled();
  });
});

describe('query', () => {
  it('logs queries in development', async () => {
    const logger = await getDevLogger(true);
    logger.query('SELECT * FROM contacts', 50);
    expect(console.log).toHaveBeenCalled();
  });

  it('marks slow queries over threshold', async () => {
    const logger = await getDevLogger(true);
    logger.query('SELECT * FROM large_table', 200);
    expect(console.log).toHaveBeenCalled();
  });

  it('logs params when provided', async () => {
    const logger = await getDevLogger(true);
    logger.query('SELECT * FROM contacts WHERE id = $1', 10, ['abc123']);
    expect(console.log).toHaveBeenCalled();
  });
});

describe('error', () => {
  it('logs errors with details in development', async () => {
    const logger = await getDevLogger(true);
    logger.error(new Error('test error'), 'test-context', 'u1');
    expect(console.group).toHaveBeenCalled();
    expect(console.groupEnd).toHaveBeenCalled();
  });

  it('handles non-Error objects', async () => {
    const logger = await getDevLogger(true);
    expect(() => logger.error('string error')).not.toThrow();
    expect(console.group).toHaveBeenCalled();
  });

  it('converts unknown error types', async () => {
    const logger = await getDevLogger(true);
    logger.error({ custom: 'error' });
    expect(console.group).toHaveBeenCalled();
  });
});

describe('auth', () => {
  it('logs auth events in development', async () => {
    const logger = await getDevLogger(true);
    logger.auth('login', true, 'user@test.com', 'u1');
    expect(console.log).toHaveBeenCalled();
  });

  it('does not log auth events in production', async () => {
    const logger = await getDevLogger(false);
    logger.auth('login', false, 'bad@test.com');
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('email', () => {
  it('logs email events in development', async () => {
    const logger = await getDevLogger(true);
    logger.email('test@test.com', 'Welcome!', true);
    expect(console.log).toHaveBeenCalled();
  });

  it('does not log email events in production', async () => {
    const logger = await getDevLogger(false);
    logger.email('test@test.com', 'Welcome!', true);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  it('logs cache operations in development', async () => {
    const logger = await getDevLogger(true);
    logger.cache('GET', 'users:1', true, 5);
    expect(console.log).toHaveBeenCalled();
  });

  it('does not log cache in production', async () => {
    const logger = await getDevLogger(false);
    logger.cache('GET', 'users:1', true);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('queue', () => {
  it('logs queue events in development', async () => {
    const logger = await getDevLogger(true);
    logger.queue('send-email', 'completed', 250);
    expect(console.log).toHaveBeenCalled();
  });

  it('does not log queue in production', async () => {
    const logger = await getDevLogger(false);
    logger.queue('send-email', 'failed');
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('memory', () => {
  it('logs memory in development', async () => {
    const logger = await getDevLogger(true);
    logger.memory('test-label');
    expect(console.log).toHaveBeenCalled();
  });

  it('does not log memory in production', async () => {
    const logger = await getDevLogger(false);
    logger.memory();
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('time / timeEnd', () => {
  it('starts and ends timing in development', async () => {
    const logger = await getDevLogger(true);
    logger.time('operation');
    logger.timeEnd('operation');
    expect(console.time).toHaveBeenCalled();
    expect(console.timeEnd).toHaveBeenCalled();
  });

  it('does not time in production', async () => {
    const logger = await getDevLogger(false);
    logger.time('operation');
    expect(console.time).not.toHaveBeenCalled();
  });
});

describe('rateLimit', () => {
  it('logs rate limit info in development', async () => {
    const logger = await getDevLogger(true);
    logger.rateLimit('user:1', 50, 100);
    expect(console.log).toHaveBeenCalled();
  });

  it('does not log rate limit in production', async () => {
    const logger = await getDevLogger(false);
    logger.rateLimit('user:1', 50, 100);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('getStats', () => {
  it('returns stats object', async () => {
    const logger = await getDevLogger(true);
    const stats = logger.getStats();
    expect(stats).toHaveProperty('uptime');
    expect(stats).toHaveProperty('totalRequests');
    expect(stats).toHaveProperty('totalErrors');
    expect(stats).toHaveProperty('errorRate');
    expect(stats).toHaveProperty('avgResponseTime');
    expect(stats).toHaveProperty('avgQueryTime');
    expect(stats).toHaveProperty('totalQueries');
    expect(stats).toHaveProperty('slowQueries');
    expect(stats).toHaveProperty('recentRequests');
    expect(stats).toHaveProperty('recentErrors');
  });

  it('reports zero metrics when no activity', async () => {
    const logger = await getDevLogger(true);
    const stats = logger.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.totalErrors).toBe(0);
    expect(stats.errorRate).toBe('0%');
  });
});

describe('printStats', () => {
  it('prints stats in development', async () => {
    const logger = await getDevLogger(true);
    logger.printStats();
    expect(console.log).toHaveBeenCalled();
  });

  it('does not print stats in production', async () => {
    const logger = await getDevLogger(false);
    logger.printStats();
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('exportLogs', () => {
  it('returns serialized log data', async () => {
    const logger = await getDevLogger(true);
    logger.request('GET', '/api', 200, 10);
    logger.error(new Error('boom'), 'ctx');
    const dump = logger.exportLogs();
    expect(dump).toHaveProperty('timestamp');
    expect(dump).toHaveProperty('stats');
    expect(dump).toHaveProperty('requests');
    expect(dump).toHaveProperty('queries');
    expect(dump).toHaveProperty('errors');
    expect(dump.requests).toHaveLength(1);
    expect(dump.errors).toHaveLength(1);
  });
});

describe('clear', () => {
  it('clears all logs and console', async () => {
    const logger = await getDevLogger(true);
    logger.request('GET', '/api', 200, 10);
    logger.clear();
    expect(console.clear).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
  });
});

describe('createDevelopmentMiddleware', () => {
  it('returns a middleware function', async () => {
    const { createDevelopmentMiddleware } = await import('@/lib/dev-logger');
    const middleware = createDevelopmentMiddleware();
    expect(typeof middleware).toBe('function');
  });

  it('calls next and tracks response', async () => {
    const { createDevelopmentMiddleware } = await import('@/lib/dev-logger');
    const middleware = createDevelopmentMiddleware();
    const req = { method: 'GET', url: '/api/test', ip: '127.0.0.1', user: { id: 'u1' } };
    const res = {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') cb();
      }),
      statusCode: 200,
    };
    const next = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    middleware(req as any, res as any, next);
    expect(next).toHaveBeenCalled();
  });
});
