/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Safe Database Connection Wrapper
 *
 * Wraps the PostgreSQL pool with circuit breaker + retry logic for transient errors.
 * Logs every failed query with full context for diagnostics.
 */

import { CircuitBreaker } from '@/lib/retry';
import { getPool } from '@/lib/db/pool';
import { logError } from '@/lib/errors-server';
import type { Pool, PoolClient, QueryResult } from 'pg';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface SafeQueryOptions {
  /** Tenant ID for contextual logging */
  tenantId?: string;
  /** Maximum number of retries for transient errors */
  maxRetries?: number;
  /** Initial delay between retries in ms */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms */
  maxDelayMs?: number;
  /** Label/context for logging */
  label?: string;
}

export interface PoolHealthStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export interface DatabaseHealthResult {
  healthy: boolean;
  reachable: boolean;
  latencyMs: number;
  poolStats: PoolHealthStats;
  error?: string;
}

// -------------------------------------------------------------------
// Transient error detection
// -------------------------------------------------------------------

/** PostgreSQL error codes that are safe to retry */
const TRANSIENT_ERROR_CODES = new Set([
  '40P01', // deadlock_detected
  '40001', // serialization_failure
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
]);

/** Node-level error codes that indicate a transient connection issue */
const TRANSIENT_NODE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

/** Non-retryable error code classes (constraint violations, syntax, permissions) */
const NON_RETRYABLE_CLASSES = new Set([
  '23', // integrity_constraint_violation
  '42', // syntax_error_or_access_rule_violation
  '28', // invalid_authorization_specification
  '2F', // sql_routine_exception
  '22', // data_exception
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isTransientError(error: any): boolean {
  if (!error) return false;

  // Check PostgreSQL error code
  const code: string | undefined = error.code;
  if (code && TRANSIENT_ERROR_CODES.has(code)) return true;

  // Check Node.js network error codes
  if (code && TRANSIENT_NODE_CODES.has(code)) return true;

  // Check by class prefix (first two characters) for non-retryable
  if (code && NON_RETRYABLE_CLASSES.has(code.slice(0, 2))) return false;

  // Connection-level errors from the driver
  const msg = String(error.message || '').toLowerCase();
  if (
    msg.includes('connection terminated') ||
    msg.includes('connection reset') ||
    msg.includes('cannot connect now')
  ) {
    return true;
  }

  return false;
}

// -------------------------------------------------------------------
// Module-level state
// -------------------------------------------------------------------

const circuitBreaker = new CircuitBreaker(5, 60_000);

// -------------------------------------------------------------------
// Core safe query
// -------------------------------------------------------------------

function truncateQuery(query: string, maxLen = 200): string {
  if (query.length <= maxLen) return query;
  return query.slice(0, maxLen) + '...';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a SQL query with circuit breaker protection and automatic retry
 * for transient errors.
 */
export async function safeQuery<T extends QueryResult = QueryResult>(
  queryText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any[],
  options: SafeQueryOptions = {}
): Promise<T> {
  const {
    tenantId,
    maxRetries = 3,
    initialDelayMs = 200,
    maxDelayMs = 5000,
    label = 'safeQuery',
  } = options;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await circuitBreaker.execute(async () => {
        const pool: Pool = getPool();
        return pool.query(queryText, params) as Promise<T>;
      });
      return result;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      lastError = error;

      // If circuit breaker itself is open, do not retry
      if (error?.message === 'Circuit breaker is open') {
        await logQueryFailure(error, queryText, attempt, { tenantId, label });
        throw error;
      }

      // If the error is non-transient, fail immediately
      if (!isTransientError(error)) {
        await logQueryFailure(error, queryText, attempt, { tenantId, label });
        throw error;
      }

      // If out of retries, log and throw
      if (attempt === maxRetries) {
        await logQueryFailure(error, queryText, attempt, { tenantId, label });
        throw error;
      }

      // Wait before retrying
      const waitTime = Math.min(delay, maxDelayMs);
      await sleep(waitTime);
      delay *= 2;
    }
  }

  // Should be unreachable, but satisfies TypeScript
  throw lastError;
}

/**
 * Execute work inside a transaction with safe retry semantics.
 * If the transaction fails with a transient error, the entire
 * transaction is retried from scratch (since partial state is rolled back).
 */
export async function safeTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  options: SafeQueryOptions = {}
): Promise<T> {
  const {
    tenantId,
    maxRetries = 3,
    initialDelayMs = 200,
    maxDelayMs = 5000,
    label = 'safeTransaction',
  } = options;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await circuitBreaker.execute(async () => {
        const pool: Pool = getPool();
        const client = await pool.connect();
        let txError: unknown = null;
        try {
          await client.query('BEGIN');
          const value = await work(client);
          await client.query('COMMIT');
          return value;
        } catch (txErr) {
          txError = txErr;
          await client.query('ROLLBACK').catch(() => {
            /* ignore rollback errors */
          });
          throw txErr;
        } finally {
          // Pass true to release() when the transaction threw an error.
          // This tells pg to destroy the client instead of returning it to
          // the pool, preventing a potentially broken connection from being reused.
          client.release(txError ? true : undefined);
        }
      });
      return result;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      lastError = error;

      if (error?.message === 'Circuit breaker is open') {
        await logQueryFailure(error, `[transaction: ${label}]`, attempt, { tenantId, label });
        throw error;
      }

      if (!isTransientError(error)) {
        await logQueryFailure(error, `[transaction: ${label}]`, attempt, { tenantId, label });
        throw error;
      }

      if (attempt === maxRetries) {
        await logQueryFailure(error, `[transaction: ${label}]`, attempt, { tenantId, label });
        throw error;
      }

      const waitTime = Math.min(delay, maxDelayMs);
      await sleep(waitTime);
      delay *= 2;
    }
  }

  throw lastError;
}

// -------------------------------------------------------------------
// Health check
// -------------------------------------------------------------------

/**
 * Check database connectivity and return pool statistics.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  const start = Date.now();
  try {
    const pool: Pool = getPool();
    await pool.query('SELECT 1');
    const latencyMs = Date.now() - start;

    return {
      healthy: true,
      reachable: true,
      latencyMs,
      poolStats: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return {
      healthy: false,
      reachable: false,
      latencyMs: Date.now() - start,
      poolStats: { totalCount: 0, idleCount: 0, waitingCount: 0 },
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Get the circuit breaker for external inspection/testing.
 */
export function getCircuitBreaker(): CircuitBreaker {
  return circuitBreaker;
}

/**
 * Expose transient-error detection for testing.
 */
export { isTransientError };

// -------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------

async function logQueryFailure(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any,
  queryText: string,
  attempt: number,
  context: { tenantId?: string; label?: string }
): Promise<void> {
  try {
    await logError({
      error,
      context: `[SafeConnection] ${context.label || 'query'} failed (attempt ${attempt + 1})`,
      tenantId: context.tenantId,
      metadata: {
        querySnippet: truncateQuery(queryText),
        errorCode: error?.code || 'N/A',
        attempt: attempt + 1,
      },
    });
  } catch {
    // Best-effort logging; never let logging itself fail the caller
    console.error(
      `[SafeConnection] Failed to log error for query: ${truncateQuery(queryText, 80)}`,
      error?.message
    );
  }
}
