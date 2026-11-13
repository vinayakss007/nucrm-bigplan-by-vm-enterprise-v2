/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assertPoolMode,
  guardPoolMode,
  getPoolModeGuardStatus,
  resetPoolModeGuardStatus,
  isPgBouncerInUse,
  PoolModeInvariantError,
  POOL_MODE_GUARD_ENV,
} from '@/lib/db/pool-mode-guard';

describe('assertPoolMode (#3506)', () => {
  it('returns "session" when SHOW pool_mode returns session', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ pool_mode: 'session' }],
    });

    const result = await assertPoolMode(mockQuery);
    expect(result).toBe('session');
    expect(mockQuery).toHaveBeenCalledWith('SHOW pool_mode');
  });

  it('handles case-insensitivity and whitespace in returned pool_mode', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ pool_mode: '  SESSION  ' }],
    });

    const result = await assertPoolMode(mockQuery);
    expect(result).toBe('session');
  });

  it('accepts alternative column naming from PgBouncer SHOW commands', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ value: 'session' }],
    });

    const result = await assertPoolMode(mockQuery);
    expect(result).toBe('session');
  });

  it('throws PoolModeInvariantError when pool_mode is transaction', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ pool_mode: 'transaction' }],
    });

    await expect(assertPoolMode(mockQuery)).rejects.toThrow(PoolModeInvariantError);
    await expect(assertPoolMode(mockQuery)).rejects.toThrow(/requires "session" mode/);
    await expect(assertPoolMode(mockQuery)).rejects.toThrow(/ADR-0003, #3404, #3506/);
  });

  it('throws PoolModeInvariantError when pool_mode is statement', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ pool_mode: 'statement' }],
    });

    await expect(assertPoolMode(mockQuery)).rejects.toThrow(PoolModeInvariantError);
    await expect(assertPoolMode(mockQuery)).rejects.toThrow(/requires "session" mode/);
  });

  it('throws PoolModeInvariantError when SHOW pool_mode returns empty rows', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [],
    });

    await expect(assertPoolMode(mockQuery)).rejects.toThrow(PoolModeInvariantError);
    await expect(assertPoolMode(mockQuery)).rejects.toThrow(/empty result/);
  });

  it('throws helpful PoolModeInvariantError when query fails with unrecognized configuration parameter (direct Postgres)', async () => {
    const error = new Error('unrecognized configuration parameter "pool_mode"');
    (error as unknown as { code: string }).code = '42704';
    const mockQuery = vi.fn().mockRejectedValue(error);

    await expect(assertPoolMode(mockQuery)).rejects.toThrow(PoolModeInvariantError);
    await expect(assertPoolMode(mockQuery)).rejects.toThrow(/target direct PostgreSQL \(:5432\)/);
    await expect(assertPoolMode(mockQuery)).rejects.toThrow(/PGBOUNCER_ENABLED=false \(#3509\)/);
  });
});

describe('isPgBouncerInUse (#3506)', () => {
  it('returns true when PGBOUNCER_ENABLED is true', () => {
    expect(isPgBouncerInUse({ PGBOUNCER_ENABLED: 'true' })).toBe(true);
  });

  it('returns true when DATABASE_URL targets port 6432', () => {
    expect(
      isPgBouncerInUse({
        PGBOUNCER_ENABLED: 'false',
        DATABASE_URL: 'postgresql://nucrm:secret@127.0.0.1:6432/nucrm',
      })
    ).toBe(true);
  });

  it('returns false for direct :5432 with PGBOUNCER_ENABLED=false', () => {
    expect(
      isPgBouncerInUse({
        PGBOUNCER_ENABLED: 'false',
        DATABASE_URL: 'postgresql://nucrm:secret@127.0.0.1:5432/nucrm',
      })
    ).toBe(false);
  });

  it('returns false when unset and pointing to default postgres', () => {
    expect(
      isPgBouncerInUse({
        DATABASE_URL: 'postgresql://nucrm:secret@localhost:5432/nucrm',
      })
    ).toBe(false);
  });
});

describe('guardPoolMode (#3506)', () => {
  beforeEach(() => {
    resetPoolModeGuardStatus();
  });

  it('skips verification when PgBouncer is not in use', async () => {
    const status = await guardPoolMode({
      env: {
        PGBOUNCER_ENABLED: 'false',
        DATABASE_URL: 'postgresql://nucrm:pass@localhost:5432/nucrm',
      },
    });

    expect(status.state).toBe('skipped');
    expect(status.detail).toContain('not in use');
    expect(getPoolModeGuardStatus()).toEqual(status);
  });

  it('skips verification when POOL_MODE_GUARD=false', async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const status = await guardPoolMode({
      env: {
        [POOL_MODE_GUARD_ENV]: 'false',
        PGBOUNCER_ENABLED: 'true',
        DATABASE_URL: 'postgresql://nucrm:pass@localhost:6432/nucrm',
      },
      log,
    });

    expect(status.state).toBe('disabled');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('DISABLED'));
  });

  it('verifies session mode when PgBouncer is in use', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ pool_mode: 'session' }],
    });
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const status = await guardPoolMode({
      env: {
        PGBOUNCER_ENABLED: 'true',
        DATABASE_URL: 'postgresql://nucrm:pass@localhost:6432/nucrm',
      },
      runQuery: mockQuery,
      log,
    });

    expect(status.state).toBe('ok');
    if (status.state === 'ok') {
      expect(status.poolMode).toBe('session');
    }
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('OK — PgBouncer pool_mode is "session"'));
    expect(getPoolModeGuardStatus()).toEqual(status);
  });

  it('detects violation, logs error and sends critical alert when mode is transaction', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ pool_mode: 'transaction' }],
    });
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const notify = vi.fn().mockResolvedValue(undefined);

    const status = await guardPoolMode({
      env: {
        PGBOUNCER_ENABLED: 'true',
        DATABASE_URL: 'postgresql://nucrm:pass@localhost:6432/nucrm',
      },
      runQuery: mockQuery,
      log,
      notify,
    });

    expect(status.state).toBe('violation');
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('FATAL INVARIANT VIOLATION (#3506)'));
    expect(notify).toHaveBeenCalledWith({
      error: expect.any(Error),
      level: 'fatal',
      context: 'db-pool-mode-guard',
    });
    expect(getPoolModeGuardStatus()?.state).toBe('violation');
  });
});

describe('warmPool with PgBouncer (#3506)', () => {
  it('throws PoolModeInvariantError when pool_mode is not session during warm-up', async () => {
    const { warmPool } = await import('@/lib/db/warmup');

    const originalEnv = { ...process.env };
    process.env['PGBOUNCER_ENABLED'] = 'true';
    process.env['DATABASE_URL'] = 'postgresql://nucrm:secret@127.0.0.1:6432/nucrm';

    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'SHOW pool_mode') {
          return Promise.resolve({ rows: [{ pool_mode: 'transaction' }] });
        }
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      options: { max: 10 },
    };

    // Set __pgPool
    (global as unknown as { __pgPool: unknown }).__pgPool = mockPool;

    try {
      await expect(warmPool(1, 1000)).rejects.toThrow(PoolModeInvariantError);
    } finally {
      process.env = originalEnv;
      (global as unknown as { __pgPool: unknown }).__pgPool = undefined;
    }
  });

  it('succeeds when pool_mode is session during warm-up', async () => {
    const { warmPool } = await import('@/lib/db/warmup');

    const originalEnv = { ...process.env };
    process.env['PGBOUNCER_ENABLED'] = 'true';
    process.env['DATABASE_URL'] = 'postgresql://nucrm:secret@127.0.0.1:6432/nucrm';

    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'SHOW pool_mode') {
          return Promise.resolve({ rows: [{ pool_mode: 'session' }] });
        }
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      options: { max: 10 },
    };

    (global as unknown as { __pgPool: unknown }).__pgPool = mockPool;

    try {
      const warmed = await warmPool(2, 1000);
      expect(warmed).toBe(2);
      expect(mockClient.query).toHaveBeenCalledWith('SHOW pool_mode');
    } finally {
      process.env = originalEnv;
      (global as unknown as { __pgPool: unknown }).__pgPool = undefined;
    }
  });
});

describe('/api/system/ready pool_mode guard integration (#3506)', () => {
  it('returns 503 with reason "pool_mode_violation" when pool_mode guard is in violation', async () => {
    const { GET } = await import('@/app/api/system/ready/route');
    const { guardPoolMode } = await import('@/lib/db/pool-mode-guard');

    // Trigger violation state
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ pool_mode: 'transaction' }],
    });
    await guardPoolMode({
      env: {
        PGBOUNCER_ENABLED: 'true',
        DATABASE_URL: 'postgresql://nucrm:pass@localhost:6432/nucrm',
      },
      runQuery: mockQuery,
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      notify: vi.fn().mockResolvedValue(undefined),
    });

    const req = {
      headers: new Headers(),
      nextUrl: new URL('http://localhost:3000/api/system/ready'),
    } as unknown as import('next/server').NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ready: false, reason: 'pool_mode_violation' });
  });
});
