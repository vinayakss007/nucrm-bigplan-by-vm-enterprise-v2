import { Pool } from 'pg';
import { pgSslConfig } from './ssl-config';

declare global { var __pgPool: Pool | undefined; }

/**
 * Maximum number of clients waiting to acquire a connection from the pool.
 * If exceeded, new connection attempts are rejected immediately to prevent
 * cascading failures from unbounded queue growth.
 */
const MAX_WAITING_CLIENTS = 50;

function isPgBouncerEnabled(): boolean {
  return process.env['PGBOUNCER_ENABLED'] === 'true';
}

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxSize: number;
  exhausted: boolean;
}

/**
 * Returns current pool utilization statistics.
 */
export function getPoolStats(): PoolStats {
  const pool = global.__pgPool;
  if (!pool) {
    return { totalCount: 0, idleCount: 0, waitingCount: 0, maxSize: 0, exhausted: false };
  }
  const maxSize = (pool as Pool & { options?: { max?: number } }).options?.max ?? 20;
  const exhausted = pool.waitingCount > MAX_WAITING_CLIENTS;
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxSize,
    exhausted,
  };
}

/**
 * Get the singleton PostgreSQL connection pool.
 * Rejects immediately if the pool waiting queue exceeds MAX_WAITING_CLIENTS
 * to prevent cascading failures from connection exhaustion.
 */
export function getPool(): Pool {
  if (!global.__pgPool) {
    const pgBouncer = isPgBouncerEnabled();
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error('DATABASE_URL is required');

    // Validate URL has explicit username (prevents pg library fallback to OS user "root")
    try {
      const parsed = new URL(cs);
      if (!parsed.username || parsed.username === 'root') {
        throw new Error(
          `DATABASE_URL must contain an explicit username (got "${parsed.username}"). ` +
          'The pg library falls back to process.env.USER which may be "root" in CI.',
        );
      }
    } catch (e) {
      if (e instanceof TypeError) {
        throw new Error('DATABASE_URL is not a valid connection string');
      }
      throw e;
    }


    const poolSize = parseInt(process.env['DATABASE_POOL_SIZE'] ?? '20');
    if (poolSize < 1 || poolSize > 100) {
      throw new Error('DATABASE_POOL_SIZE must be between 1 and 100');
    }

    // Append pgbouncer=true to connection string when PgBouncer is active
    const connectionString = pgBouncer
      ? cs + (cs.includes('?') ? '&' : '?') + 'pgbouncer=true'
      : cs;

    global.__pgPool = new Pool({
      connectionString,
      ssl: pgSslConfig(),
      max: poolSize,
      idleTimeoutMillis: pgBouncer ? 10_000 : 60_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
      statement_timeout: parseInt(process.env['DATABASE_STATEMENT_TIMEOUT'] ?? '10000'),
    });

    global.__pgPool.on('error', (err) => {
      const pool = global.__pgPool;
      if (pool && pool.waitingCount > pool.totalCount * 2) {
        console.error(
          `[db-pool] CRITICAL: Pool exhaustion detected! waiting=${pool.waitingCount} total=${pool.totalCount}`,
        );
      }
      console.error('[db-pool] error:', err.message);
    });
  }

  // Reject early if pool waiting queue is too deep
  const pool = global.__pgPool;
  if (pool.waitingCount > MAX_WAITING_CLIENTS) {
    throw new Error(
      `Connection pool exhausted: ${pool.waitingCount} requests waiting (max ${MAX_WAITING_CLIENTS}). ` +
      'Increase DATABASE_POOL_SIZE or reduce concurrent queries.',
    );
  }

  return pool;
}
