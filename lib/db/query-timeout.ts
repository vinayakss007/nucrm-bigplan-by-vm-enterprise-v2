/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Per-query statement timeout.
 *
 * The pool carries a global statement_timeout (default 10s). This is correct
 * for CRUD but wrong for two cases:
 *
 *  1. Reports, analytics, data export — these legitimately run 30-60s queries.
 *     The global timeout kills them, producing "canceling statement due to
 *     statement_timeout" errors that look like bugs to the user.
 *
 *  2. Health probes, quick lookups — these should fail FASTER than 10s so the
 *     readiness probe doesn't hang.
 *
 * This helper lets a route run a query with a custom timeout without changing
 * the pool-level default for everyone else.
 *
 * Usage:
 *   import { withTimeout } from '@/lib/db/query-timeout';
 *
 *   // Report builder: allow up to 60s
 *   const results = await withTimeout(60_000, async (client) => {
 *     return client.query('SELECT ... expensive aggregation ...');
 *   });
 *
 *   // Fast probe: fail in 3s
 *   const alive = await withTimeout(3_000, async (client) => {
 *     return client.query('SELECT 1');
 *   });
 *
 * The timeout is set via SET LOCAL (transaction-scoped) so it cannot leak to
 * other queries on the same pooled connection.
 */

import { getPool } from './pool';
import type { PoolClient, QueryResult } from 'pg';

/**
 * Build the `SET [LOCAL] statement_timeout` statement for a request.
 *
 * Every timeout that reaches Postgres as text goes through here — this module,
 * `lib/api/with-transaction.ts` and `lib/cron/distributed-lock.ts` all did the
 * same thing inline, and only one of them clamped. A value interpolated without
 * clamping is a statement: `SET statement_timeout = '0'; UPDATE ... --` runs the
 * second statement with the connection's own privileges (#2528).
 *
 * @param timeoutMs - Milliseconds; floored at 1 and rounded to an integer.
 * @param options.local - Emit `SET LOCAL` (transaction-scoped, cannot leak to
 *   the next borrower of this pooled connection) instead of `SET`.
 * @throws TypeError on a non-finite value, so a bad config fails loudly in the
 *   route instead of as a Postgres 22023 mid-transaction.
 */
export function statementTimeoutSql(
  timeoutMs: number,
  options: { local?: boolean } = {},
): string {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    throw new TypeError(
      `statementTimeoutSql: timeout must be a finite number of milliseconds, got ${String(timeoutMs)}`,
    );
  }
  const ms = Math.max(1, Math.round(timeoutMs));
  return `SET ${options.local ? 'LOCAL ' : ''}statement_timeout = '${ms}'`;
}

/**
 * Run a function with a custom statement timeout on a dedicated client.
 *
 * - Acquires a client from the pool
 * - Sets statement_timeout via SET LOCAL inside a transaction
 * - Executes your callback
 * - Always releases the client (even on error)
 *
 * @param timeoutMs - Statement timeout in milliseconds
 * @param fn - Receives the client, must return a promise
 */
export async function withTimeout<T>(
  timeoutMs: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // SET LOCAL only lasts for the current transaction, so we wrap in one.
    await client.query('BEGIN');
    await client.query(statementTimeoutSql(timeoutMs, { local: true }));

    const result = await fn(client);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    // #1837: a failing ROLLBACK can leave the connection in a bad state; make
    // it observable instead of silent. We still rethrow the ORIGINAL error and
    // never let a rollback failure mask it.
    await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
      console.error(
        '[query-timeout] ROLLBACK failed after query error:',
        rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      );
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Convenience: run a single SQL query with a custom timeout.
 */
export async function queryWithTimeout<T extends QueryResult = QueryResult>(
  timeoutMs: number,
  sql: string,
  params?: unknown[],
): Promise<T> {
  return withTimeout(timeoutMs, (client) => client.query(sql, params) as Promise<T>);
}

/** Default timeouts for different operation classes. */
export const TIMEOUTS = {
  /** Health probes, simple existence checks */
  FAST: 3_000,
  /** Normal CRUD operations (pool default) */
  NORMAL: 10_000,
  /** Report builder, analytics, data export */
  REPORT: 60_000,
  /** Full workspace export, bulk operations */
  BULK: 120_000,
} as const;
