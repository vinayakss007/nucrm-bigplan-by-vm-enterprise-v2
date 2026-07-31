/**
 * Read replica routing.
 *
 * When DATABASE_READ_REPLICA_URL is configured, heavy read operations (reports,
 * search, dashboards, analytics) can use `dbRead` instead of `db` to route
 * queries to the replica and reduce load on the primary.
 *
 * When the variable is absent, `dbRead` transparently falls back to the primary
 * so callers never need conditional logic.
 *
 * Usage:
 *   import { dbRead } from '@/lib/db/read-replica';
 *   const results = await dbRead.select().from(contacts).where(...);
 *
 * IMPORTANT: Never use dbRead for queries that depend on data you just wrote.
 * Replication lag (typically <100ms) means the replica may not yet have the
 * latest row. Use it only for reads that tolerate slight staleness: report
 * building, search indexing, dashboard widgets, analytics, data export.
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/drizzle/schema';
import { db as primaryDb } from '@/drizzle/db';
import { pgSslConfig } from './ssl-config';

declare global {
  var __pgReadPool: Pool | undefined;
}

function getReadPool(): Pool {
  if (!global.__pgReadPool) {
    const replicaUrl = process.env.DATABASE_READ_REPLICA_URL;
    if (!replicaUrl) {
      // No replica configured — return null so we fall back to primary
      throw new Error('NO_REPLICA');
    }

    const poolSize = parseInt(process.env.DATABASE_READ_POOL_SIZE ?? '10');

    global.__pgReadPool = new Pool({
      connectionString: replicaUrl,
      ssl: pgSslConfig(),
      max: poolSize,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      // Read queries can afford a longer statement timeout since they
      // run reports and aggregations.
      statement_timeout: parseInt(process.env.DATABASE_READ_STATEMENT_TIMEOUT ?? '30000'),
    });

    global.__pgReadPool.on('error', (err) => {
      console.error('[db-read-pool] error:', err.message);
    });
  }
  return global.__pgReadPool;
}

type DbClient = NodePgDatabase<typeof schema>;

/** Get the primary DB client for fallback when no replica is configured. */
function getPrimaryDb(): DbClient {
  return primaryDb;
}

let _dbRead: DbClient | null = null;
let _fallbackToPrimary = false;

/**
 * Get a Drizzle client routed to the read replica.
 *
 * Falls back to the primary if DATABASE_READ_REPLICA_URL is not configured.
 * This means callers can always import and use `dbRead` without checking
 * whether a replica exists — it degrades gracefully to the primary.
 */
function getDbRead(): DbClient {
  if (_fallbackToPrimary) {
    // Already determined there's no replica — use primary.
    // Dynamic import is not usable here (sync getter), so we import at module
    // level and cache. The circular dependency is safe: drizzle/db.ts does not
    // import this file.
    return getPrimaryDb();
  }

  if (!_dbRead) {
    try {
      const pool = getReadPool();
      _dbRead = drizzle(pool, { schema });
    } catch (err) {
      if (err instanceof Error && err.message === 'NO_REPLICA') {
        _fallbackToPrimary = true;
        return getPrimaryDb();
      }
      throw err;
    }
  }

  return _dbRead;
}

/**
 * Read-only database client.
 *
 * Routed to DATABASE_READ_REPLICA_URL when configured, otherwise falls back
 * to the primary. Safe to use anywhere you would use `db` for reads, with the
 * understanding that results may be up to ~100ms stale.
 */
export const dbRead: DbClient = new Proxy({} as DbClient, {
  get(_, prop) {
    const target = getDbRead();
    const value = target[prop as keyof DbClient];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(target);
    }
    return value;
  },
});

/**
 * Whether queries are actually going to a separate replica instance.
 * Useful for monitoring dashboards and the health endpoint.
 */
export function isReplicaConfigured(): boolean {
  return Boolean(process.env.DATABASE_READ_REPLICA_URL);
}

/**
 * Close the read replica pool (for graceful shutdown).
 */
export async function closeReadPool(): Promise<void> {
  if (global.__pgReadPool) {
    await global.__pgReadPool.end();
    global.__pgReadPool = undefined;
    _dbRead = null;
  }
}
