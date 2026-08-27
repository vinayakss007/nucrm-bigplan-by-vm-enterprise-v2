/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { Pool } from 'pg';
import type { PoolConfig, PoolClient } from 'pg';
import { pgSslConfig } from './ssl-config';

declare global { var __pgPool: Pool | undefined; var __pgPoolCreating: boolean | undefined; }

/**
 * Maximum number of clients waiting to acquire a connection from the pool.
 * If exceeded, new connection attempts are rejected immediately to prevent
 * cascading failures from unbounded queue growth.
 */
const MAX_WAITING_CLIENTS = 50;

// #1188: warn at most once per 30s instead of throwing for every caller —
// connection-level timeouts (connectionTimeoutMillis / statement_timeout)
// already guard against hangs, and idle capacity may free up.
let lastExhaustionWarnAt = 0;

function warnPoolSaturation(waitingCount: number): void {
  const now = Date.now();
  if (now - lastExhaustionWarnAt >= 30_000) {
    lastExhaustionWarnAt = now;
    console.error(
      `[db-pool] WARNING: Connection pool saturated: ${waitingCount} requests waiting (max ${MAX_WAITING_CLIENTS}). ` +
      'Increase DATABASE_POOL_SIZE or reduce concurrent queries.',
    );
  }
}

function isPgBouncerEnabled(): boolean {
  return process.env['PGBOUNCER_ENABLED'] === 'true';
}

/**
 * Parse a positive integer from an env var, falling back to `fallback` when the
 * value is unset or non-numeric. Guards against parseInt() returning NaN for a
 * garbage value (e.g. DATABASE_POOL_SIZE="abc"), which would otherwise slip past
 * range checks and configure the pool with NaN (#1308).
 */
function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
 * #1188: when the waiting queue exceeds MAX_WAITING_CLIENTS, logs a
 * throttled warning and still returns the pool — connection-level
 * timeouts guard against hangs. Use getPoolStats().exhausted for
 * health-check signal.
 */
export function getPool(): Pool {
  if (global.__pgPool) {
    // Pool already exists — fast path
    const pool = global.__pgPool;
    if (pool.waitingCount > MAX_WAITING_CLIENTS) {
      warnPoolSaturation(pool.waitingCount);
    }
    return pool;
  }

  // Race-condition guard: only one caller creates the pool
  if (global.__pgPoolCreating) {
    // Another caller is currently creating the pool — spin briefly
    const start = Date.now();
    while (global.__pgPoolCreating && Date.now() - start < 30_000) {
      // busy-wait is fine here; pool creation takes <100ms
    }
    if (!global.__pgPool) {
      throw new Error('Pool creation timed out');
    }
    return global.__pgPool;
  }

  global.__pgPoolCreating = true;
  try {
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

    const poolSize = parseIntEnv(process.env['DATABASE_POOL_SIZE'], 20);
    if (poolSize < 1 || poolSize > 100) {
      throw new Error('DATABASE_POOL_SIZE must be between 1 and 100');
    }

    // Append pgbouncer=true to connection string when PgBouncer is active
    const connectionString = pgBouncer
      ? cs + (cs.includes('?') ? '&' : '?') + 'pgbouncer=true'
      : cs;

    const poolConfig: PoolConfig = {
      connectionString,
      ssl: pgSslConfig(),
      max: poolSize,
      idleTimeoutMillis: pgBouncer ? 10_000 : 60_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
      statement_timeout: parseIntEnv(process.env['DATABASE_STATEMENT_TIMEOUT'], 10000),
    };

    global.__pgPool = new Pool(poolConfig);

    // RLS isolation guard (audit C-1).
    //
    // setTenantContext() sets app.current_tenant as a SESSION-scoped GUC
    // (is_local=false) so it survives across the multiple statements of one
    // request. On PgBouncer transaction-mode that GUC is cleared by
    // server_reset_query='DISCARD ALL' when the connection returns to the pool.
    // But this app talks to a plain node-postgres pool by default
    // (PGBOUNCER_ENABLED unset), so nothing clears it — a tenant-A GUC would
    // persist on the physical connection and could be observed by the next
    // request that checks that connection out before its own setTenantContext
    // runs.
    //
    // So when NOT behind PgBouncer we clear the GUCs on every release back to
    // the pool (our own lightweight DISCARD-ALL for just these settings). The
    // client is idle at this point and node-postgres serialises queries per
    // client, so the RESET completes before the connection is handed to the
    // next checkout. Combined with the fail-closed RLS policy (empty tenant GUC
    // => deny), a request can never inherit a previous request's tenant
    // context. (pg-pool's `verify` hook is NOT used: it only runs for brand-new
    // physical connections, not on reuse of idle ones — verified empirically.)
    if (!pgBouncer) {
      global.__pgPool.on('release', (_err: Error | undefined, client: PoolClient) => {
        // Fire-and-forget: RESET cannot fail meaningfully, and any error is
        // surfaced via the pool 'error' handler. Swallow to avoid unhandled
        // rejections on a client that may be tearing down.
        void client
          .query("SELECT set_config('app.current_tenant', '', false), set_config('app.current_user', '', false)")
          .catch(() => { /* client removed/ending — next checkout re-resets */ });
      });
    }

    global.__pgPool.on('error', (err) => {
      const pool = global.__pgPool;
      if (pool && pool.waitingCount > pool.totalCount * 2) {
        console.error(
          `[db-pool] CRITICAL: Pool exhaustion detected! waiting=${pool.waitingCount} total=${pool.totalCount}`,
        );
      }
      console.error('[db-pool] error:', err.message);
    });

    // Warn (don't throw) if the waiting queue is deep — callers still get the pool
    const pool = global.__pgPool;
    if (pool.waitingCount > MAX_WAITING_CLIENTS) {
      warnPoolSaturation(pool.waitingCount);
    }

    return pool;
  } finally {
    global.__pgPoolCreating = false;
  }
}
