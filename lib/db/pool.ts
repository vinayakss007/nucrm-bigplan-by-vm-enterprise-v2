import { Pool } from 'pg';

declare global { var __pgPool: Pool | undefined; }

function isPgBouncerEnabled(): boolean {
  return process.env['PGBOUNCER_ENABLED'] === 'true';
}

/**
 * Get the singleton PostgreSQL connection pool
 */
export function getPool(): Pool {
  if (!global.__pgPool) {
    const pgBouncer = isPgBouncerEnabled();
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error('DATABASE_URL is required');
    const ssl = process.env.DATABASE_SSL !== 'false';

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
      ssl: ssl ? { rejectUnauthorized: process.env.NODE_ENV === 'production' } : false,
      max: poolSize,
      idleTimeoutMillis: pgBouncer ? 10_000 : 60_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
      statement_timeout: parseInt(process.env['DATABASE_STATEMENT_TIMEOUT'] ?? '10000'),
    });
    global.__pgPool.on('error', err => console.error('[db-pool] error:', err.message));
  }
  return global.__pgPool;
}
