import { Pool } from 'pg';

declare global { var __pgPool: Pool | undefined; }

/**
 * Get the singleton PostgreSQL connection pool
 */
export function getPool(): Pool {
  if (!global.__pgPool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error('DATABASE_URL is required');
    const ssl = process.env.DATABASE_SSL !== 'false';
    
    // Increased default pool size from 10 to 20 for production
    const poolSize = parseInt(process.env['DATABASE_POOL_SIZE'] ?? '20');
    if (poolSize < 1 || poolSize > 100) {
      throw new Error('DATABASE_POOL_SIZE must be between 1 and 100');
    }
    
    global.__pgPool = new Pool({
      connectionString: cs,
      ssl: ssl ? { rejectUnauthorized: process.env.NODE_ENV === 'production' } : false,
      max: poolSize,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
      statement_timeout: parseInt(process.env['DATABASE_STATEMENT_TIMEOUT'] ?? '10000'),
    });
    global.__pgPool.on('error', err => console.error('[db-pool] error:', err.message));
  }
  return global.__pgPool;
}
