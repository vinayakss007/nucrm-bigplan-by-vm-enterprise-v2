import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pg', () => {
  const MockPool = vi.fn(function MockPool() {
    return { on: vi.fn() };
  });
  return { Pool: MockPool, default: { Pool: MockPool } };
});

describe('db/pool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as typeof globalThis & { __pgPool?: unknown }).__pgPool;
    delete process.env['DATABASE_URL'];
    delete process.env['DATABASE_SSL'];
    delete process.env['DATABASE_POOL_SIZE'];
    delete process.env['PGBOUNCER_ENABLED'];
    delete process.env['DATABASE_STATEMENT_TIMEOUT'];
    delete process.env['NODE_ENV'];
  });

  it('creates Pool with DATABASE_URL', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    const pool = getPool();
    expect(pool).toBeDefined();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://nucrm@localhost:5432/nucrm',
    }));
  });

  it('returns same pool instance on second call', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    const { getPool } = await import('@/lib/db/pool');
    const p1 = getPool();
    const p2 = getPool();
    expect(p1).toBe(p2);
  });

  it('disables SSL when DATABASE_SSL=false', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    process.env['DATABASE_SSL'] = 'false';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      ssl: false,
    }));
  });

  it('enables SSL with rejectUnauthorized in production', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    process.env['NODE_ENV'] = 'production';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      ssl: { rejectUnauthorized: true },
    }));
  });

  it('enables SSL without rejectUnauthorized in development', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    process.env['NODE_ENV'] = 'development';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      ssl: { rejectUnauthorized: false },
    }));
  });

  it('appends pgbouncer=true when PGBOUNCER_ENABLED=true', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    process.env['PGBOUNCER_ENABLED'] = 'true';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://nucrm@localhost:5432/nucrm?pgbouncer=true',
      idleTimeoutMillis: 10_000,
    }));
  });

  it('appends pgbouncer with existing query params', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm?sslmode=require';
    process.env['PGBOUNCER_ENABLED'] = 'true';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://nucrm@localhost:5432/nucrm?sslmode=require&pgbouncer=true',
    }));
  });

  it('uses custom pool size', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    process.env['DATABASE_POOL_SIZE'] = '5';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      max: 5,
    }));
  });

  it('rejects a DATABASE_URL with no username', async () => {
    // pg falls back to process.env.USER when the URL omits a user, which in CI
    // is often "root" — so the connection silently targets the wrong role
    // instead of failing. Reject it up front.
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow(/explicit username/);
  });

  it('rejects a DATABASE_URL whose username is root', async () => {
    process.env['DATABASE_URL'] = 'postgresql://root@localhost:5432/nucrm';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow(/explicit username/);
  });

  // #1544 (F7): Unix-socket connection strings have no host authority, so
  // new URL() throws ERR_INVALID_URL. getPool must still accept them while
  // enforcing the explicit-username guard.
  it('accepts a Unix-socket DATABASE_URL with a username', async () => {
    process.env['DATABASE_URL'] = 'postgresql://postgres@/nucrm?host=/var/run/postgresql';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    const pool = getPool();
    expect(pool).toBeDefined();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://postgres@/nucrm?host=/var/run/postgresql',
    }));
  });

  it('accepts a Unix-socket DATABASE_URL with username and password', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm:secret@/db?host=/sock/dir';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    const pool = getPool();
    expect(pool).toBeDefined();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://nucrm:secret@/db?host=/sock/dir',
    }));
  });

  it('rejects a Unix-socket DATABASE_URL with no username', async () => {
    process.env['DATABASE_URL'] = 'postgresql:///nucrm?host=/var/run/postgresql';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow(/explicit username/);
  });

  it('rejects a Unix-socket DATABASE_URL whose username is root', async () => {
    process.env['DATABASE_URL'] = 'postgresql://root@/nucrm?host=/var/run/postgresql';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow(/explicit username/);
  });

  it('appends pgbouncer=true to a Unix-socket DATABASE_URL', async () => {
    process.env['DATABASE_URL'] = 'postgresql://postgres@/nucrm?host=/var/run/postgresql';
    process.env['PGBOUNCER_ENABLED'] = 'true';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://postgres@/nucrm?host=/var/run/postgresql&pgbouncer=true',
    }));
  });

  it('throws when DATABASE_URL is missing', async () => {
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow('DATABASE_URL is required');
  });

  it('throws when pool size is out of range', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    process.env['DATABASE_POOL_SIZE'] = '0';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
  });

  it('throws when pool size exceeds 100', async () => {
    process.env['DATABASE_URL'] = 'postgresql://nucrm@localhost:5432/nucrm';
    process.env['DATABASE_POOL_SIZE'] = '200';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
  });
});
