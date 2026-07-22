import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pg', () => {
  const MockPool = vi.fn(() => ({ on: vi.fn() }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

describe('db/pool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as any).__pgPool;
    delete process.env['DATABASE_URL'];
    delete process.env['DATABASE_SSL'];
    delete process.env['DATABASE_POOL_SIZE'];
    delete process.env['PGBOUNCER_ENABLED'];
    delete process.env['DATABASE_STATEMENT_TIMEOUT'];
    delete process.env['NODE_ENV'];
  });

  it('creates Pool with DATABASE_URL', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    const pool = getPool();
    expect(pool).toBeDefined();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://localhost:5432/nucrm',
    }));
  });

  it('returns same pool instance on second call', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    const { getPool } = await import('@/lib/db/pool');
    const p1 = getPool();
    const p2 = getPool();
    expect(p1).toBe(p2);
  });

  it('disables SSL when DATABASE_SSL=false', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    process.env['DATABASE_SSL'] = 'false';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      ssl: false,
    }));
  });

  it('enables SSL with rejectUnauthorized in production', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    process.env['NODE_ENV'] = 'production';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      ssl: { rejectUnauthorized: true },
    }));
  });

  it('enables SSL without rejectUnauthorized in development', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    process.env['NODE_ENV'] = 'development';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      ssl: { rejectUnauthorized: false },
    }));
  });

  it('appends pgbouncer=true when PGBOUNCER_ENABLED=true', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    process.env['PGBOUNCER_ENABLED'] = 'true';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://localhost:5432/nucrm?pgbouncer=true',
      idleTimeoutMillis: 10_000,
    }));
  });

  it('appends pgbouncer with existing query params', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm?sslmode=require';
    process.env['PGBOUNCER_ENABLED'] = 'true';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://localhost:5432/nucrm?sslmode=require&pgbouncer=true',
    }));
  });

  it('uses custom pool size', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    process.env['DATABASE_POOL_SIZE'] = '5';
    const { Pool } = await import('pg');
    const { getPool } = await import('@/lib/db/pool');
    getPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      max: 5,
    }));
  });

  it('throws when DATABASE_URL is missing', async () => {
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow('DATABASE_URL is required');
  });

  it('throws when pool size is out of range', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    process.env['DATABASE_POOL_SIZE'] = '0';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
  });

  it('throws when pool size exceeds 100', async () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/nucrm';
    process.env['DATABASE_POOL_SIZE'] = '200';
    const { getPool } = await import('@/lib/db/pool');
    expect(() => getPool()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
  });
});
