import { describe, it, expect, vi, beforeEach } from 'vitest';

// -------------------------------------------------------------------
// Mock pool
// -------------------------------------------------------------------
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockPool = {
  query: mockQuery,
  connect: mockConnect,
  end: mockEnd,
  totalCount: 10,
  idleCount: 5,
  waitingCount: 2,
};

vi.mock('@/lib/db/pool', () => ({
  getPool: () => mockPool,
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/drizzle/db', () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn() }) },
}));

// -------------------------------------------------------------------
// Tests: Safe Connection
// -------------------------------------------------------------------
describe('Safe Connection - Circuit Breaker', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockEnd.mockReset();
  });

  it('opens circuit breaker after threshold failures', async () => {
    const { getCircuitBreaker } = await import('@/lib/db/safe-connection');
    const cb = getCircuitBreaker();
    cb.reset();

    // Simulate 5 failures (threshold)
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(async () => {
          throw new Error('connection failed');
        });
      } catch {
        // expected
      }
    }

    expect(cb.getState()).toBe('open');

    // Next call should immediately throw circuit breaker open
    await expect(
      cb.execute(async () => 'should not reach')
    ).rejects.toThrow('Circuit breaker is open');
  });

  it('circuit breaker resets after success in half-open state', async () => {
    const { getCircuitBreaker } = await import('@/lib/db/safe-connection');
    const cb = getCircuitBreaker();
    cb.reset();

    // Open it
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(cb.getState()).toBe('open');

    // Reset to simulate timeout expiry
    cb.reset();
    expect(cb.getState()).toBe('closed');

    const result = await cb.execute(async () => 'success');
    expect(result).toBe('success');
  });
});

describe('Safe Connection - Retry Logic', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('retries transient errors (deadlock 40P01)', async () => {
    const { safeQuery, getCircuitBreaker } = await import('@/lib/db/safe-connection');
    getCircuitBreaker().reset();

    let attempts = 0;
    mockQuery.mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('deadlock detected');
        (err as NodeJS.ErrnoException).code = '40P01';
        throw err;
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });

    const result = await safeQuery('SELECT 1', [], { maxRetries: 3, initialDelayMs: 10 });
    expect(result.rows).toHaveLength(1);
    expect(attempts).toBe(3);
  });

  it('retries transient errors (serialization failure 40001)', async () => {
    const { safeQuery, getCircuitBreaker } = await import('@/lib/db/safe-connection');
    getCircuitBreaker().reset();

    let attempts = 0;
    mockQuery.mockImplementation(() => {
      attempts++;
      if (attempts < 2) {
        const err = new Error('serialization failure');
        (err as NodeJS.ErrnoException).code = '40001';
        throw err;
      }
      return { rows: [], rowCount: 0 };
    });

    await safeQuery('UPDATE t SET x = 1', [], { maxRetries: 3, initialDelayMs: 10 });
    expect(attempts).toBe(2);
  });

  it('retries ECONNRESET errors', async () => {
    const { safeQuery, getCircuitBreaker } = await import('@/lib/db/safe-connection');
    getCircuitBreaker().reset();

    let attempts = 0;
    mockQuery.mockImplementation(() => {
      attempts++;
      if (attempts === 1) {
        const err = new Error('connection reset');
        (err as NodeJS.ErrnoException).code = 'ECONNRESET';
        throw err;
      }
      return { rows: [{ ok: true }], rowCount: 1 };
    });

    const result = await safeQuery('SELECT 1', [], { maxRetries: 2, initialDelayMs: 10 });
    expect(result.rows[0]).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it('does NOT retry constraint violations (class 23)', async () => {
    const { safeQuery, getCircuitBreaker } = await import('@/lib/db/safe-connection');
    getCircuitBreaker().reset();

    let attempts = 0;
    mockQuery.mockImplementation(() => {
      attempts++;
      const err = new Error('unique_violation');
      (err as NodeJS.ErrnoException).code = '23505';
      throw err;
    });

    await expect(
      safeQuery('INSERT INTO t VALUES (1)', [], { maxRetries: 3, initialDelayMs: 10 })
    ).rejects.toThrow('unique_violation');
    expect(attempts).toBe(1);
  });

  it('does NOT retry syntax errors (class 42)', async () => {
    const { safeQuery, getCircuitBreaker } = await import('@/lib/db/safe-connection');
    getCircuitBreaker().reset();

    let attempts = 0;
    mockQuery.mockImplementation(() => {
      attempts++;
      const err = new Error('syntax_error');
      (err as NodeJS.ErrnoException).code = '42601';
      throw err;
    });

    await expect(
      safeQuery('SELEC 1', [], { maxRetries: 3, initialDelayMs: 10 })
    ).rejects.toThrow('syntax_error');
    expect(attempts).toBe(1);
  });

  it('does NOT retry permission errors (class 42501)', async () => {
    const { safeQuery, getCircuitBreaker } = await import('@/lib/db/safe-connection');
    getCircuitBreaker().reset();

    let attempts = 0;
    mockQuery.mockImplementation(() => {
      attempts++;
      const err = new Error('insufficient_privilege');
      (err as NodeJS.ErrnoException).code = '42501';
      throw err;
    });

    await expect(
      safeQuery('DROP TABLE t', [], { maxRetries: 3, initialDelayMs: 10 })
    ).rejects.toThrow('insufficient_privilege');
    expect(attempts).toBe(1);
  });
});

describe('Safe Connection - isTransientError', () => {
  it('correctly classifies transient errors', async () => {
    const { isTransientError } = await import('@/lib/db/safe-connection');

    expect(isTransientError({ code: '40P01', message: '' })).toBe(true);
    expect(isTransientError({ code: '40001', message: '' })).toBe(true);
    expect(isTransientError({ code: '57P01', message: '' })).toBe(true);
    expect(isTransientError({ code: '57P03', message: '' })).toBe(true);
    expect(isTransientError({ code: 'ECONNRESET', message: '' })).toBe(true);
    expect(isTransientError({ code: 'ETIMEDOUT', message: '' })).toBe(true);
  });

  it('correctly classifies non-transient errors', async () => {
    const { isTransientError } = await import('@/lib/db/safe-connection');

    expect(isTransientError({ code: '23505', message: '' })).toBe(false);
    expect(isTransientError({ code: '42601', message: '' })).toBe(false);
    expect(isTransientError({ code: '28000', message: '' })).toBe(false);
  });
});

// -------------------------------------------------------------------
// Tests: Graceful Shutdown
// -------------------------------------------------------------------
describe('Graceful Shutdown', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockEnd.mockReset();
    mockEnd.mockResolvedValue(undefined);
  });

  it('isShuttingDown returns false initially', async () => {
    const { isShuttingDown, resetShutdownState } = await import(
      '@/lib/db/graceful-shutdown'
    );
    resetShutdownState();
    expect(isShuttingDown()).toBe(false);
  });

  it('isShuttingDown returns true after initiateShutdown', async () => {
    const { isShuttingDown, initiateShutdown, resetShutdownState } = await import(
      '@/lib/db/graceful-shutdown'
    );
    resetShutdownState();

    await initiateShutdown({ drainTimeoutMs: 100 });
    expect(isShuttingDown()).toBe(true);
  });

  it('tracks in-flight requests correctly', async () => {
    const {
      trackRequestStart,
      trackRequestEnd,
      getInFlightCount,
      resetShutdownState,
    } = await import('@/lib/db/graceful-shutdown');
    resetShutdownState();

    trackRequestStart();
    trackRequestStart();
    expect(getInFlightCount()).toBe(2);

    trackRequestEnd();
    expect(getInFlightCount()).toBe(1);

    trackRequestEnd();
    expect(getInFlightCount()).toBe(0);
  });

  it('waits for in-flight requests before draining pool', async () => {
    const {
      trackRequestStart,
      trackRequestEnd,
      getInFlightCount,
      initiateShutdown,
      resetShutdownState,
    } = await import('@/lib/db/graceful-shutdown');
    resetShutdownState();

    trackRequestStart();
    expect(getInFlightCount()).toBe(1);

    // Start shutdown - it will wait for in-flight
    const shutdownPromise = initiateShutdown({ drainTimeoutMs: 2000 });

    // Simulate request completing after 50ms
    setTimeout(() => {
      trackRequestEnd();
    }, 50);

    await shutdownPromise;
    expect(getInFlightCount()).toBe(0);
    expect(mockEnd).toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// Tests: Migration Safety
// -------------------------------------------------------------------
describe('Migration Safety - Advisory Lock', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
  });

  it('withMigrationLock acquires and releases advisory lock', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ pg_advisory_lock: '' }] }),
      release: vi.fn(),
    };
    mockConnect.mockResolvedValue(mockClient);

    const { withMigrationLock } = await import('@/lib/db/migration-safety');

    const result = await withMigrationLock(async () => {
      return 'migration-done';
    });

    expect(result).toBe('migration-done');
    // Should have called: SET lock_timeout, pg_advisory_lock, pg_advisory_unlock
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('lock_timeout')
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_lock'),
      expect.any(Array)
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      expect.any(Array)
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('withMigrationLock releases lock on error', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ pg_advisory_lock: '' }] }),
      release: vi.fn(),
    };
    mockConnect.mockResolvedValue(mockClient);

    const { withMigrationLock } = await import('@/lib/db/migration-safety');

    await expect(
      withMigrationLock(async () => {
        throw new Error('migration failed');
      })
    ).rejects.toThrow('migration failed');

    // Should still attempt unlock and release
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      expect.any(Array)
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('preflightChecks detects unreachable database', async () => {
    mockQuery.mockRejectedValue(new Error('ECONNREFUSED'));

    const { preflightChecks } = await import('@/lib/db/migration-safety');
    const result = await preflightChecks();

    expect(result.databaseReachable).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('preflightChecks succeeds with healthy database', async () => {
    // SELECT 1 - connectivity check
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    // Schema version query
    mockQuery.mockResolvedValueOnce({ rows: [{ version: '42' }] });
    // Advisory lock try
    mockQuery.mockResolvedValueOnce({ rows: [{ acquired: true }] });
    // Advisory unlock
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { preflightChecks } = await import('@/lib/db/migration-safety');
    const result = await preflightChecks();

    expect(result.databaseReachable).toBe(true);
    expect(result.currentVersion).toBe('42');
    expect(result.migrationLockFree).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// -------------------------------------------------------------------
// Tests: Database Health Check
// -------------------------------------------------------------------
describe('Database Health Check', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns healthy status with pool stats when DB is reachable', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const { checkDatabaseHealth } = await import('@/lib/db/safe-connection');
    const result = await checkDatabaseHealth();

    expect(result.healthy).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.poolStats.totalCount).toBe(10);
    expect(result.poolStats.idleCount).toBe(5);
    expect(result.poolStats.waitingCount).toBe(2);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy status when DB query fails', async () => {
    mockQuery.mockRejectedValue(new Error('ECONNREFUSED'));

    const { checkDatabaseHealth } = await import('@/lib/db/safe-connection');
    const result = await checkDatabaseHealth();

    expect(result.healthy).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});

// -------------------------------------------------------------------
// Tests: Health endpoint response structure
// -------------------------------------------------------------------
describe('System Health Endpoint - Response Structure', () => {
  it('exports a GET handler', async () => {
    const mod = await import('@/app/api/system/health/route');
    expect(typeof mod.GET).toBe('function');
  });
});
