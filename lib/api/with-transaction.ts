/**
 * API Transaction Helper.
 *
 * Wraps multi-write API handlers in a database transaction so that either all
 * writes succeed or none do. Prevents the "partial write" bug where (for
 * example) a deal is created but the associated line items fail, leaving
 * orphaned records.
 *
 * Also handles:
 * - Automatic retry on serialization failures (SQLSTATE 40001)
 * - Per-query timeout via SET LOCAL statement_timeout inside the txn
 * - Sentry capture + structured error response on failure
 *
 * Usage:
 * ```ts
 * import { withTransaction } from '@/lib/api/with-transaction';
 * import { db } from '@/drizzle/db';
 *
 * export async function POST(req: NextRequest) {
 *   const ctx = await requireAuth(req);
 *   if (ctx instanceof NextResponse) return ctx;
 *
 *   return withTransaction(db, async (tx) => {
 *     const deal = await tx.insert(deals).values({...}).returning();
 *     await tx.insert(dealProducts).values({...});
 *     await tx.insert(auditLogs).values({...});
 *     return NextResponse.json({ deal: deal[0] }, { status: 201 });
 *   });
 * }
 * ```
 *
 * The handler receives `tx` (a Drizzle transaction client) — use it for all
 * queries inside the handler. If any query throws, the entire transaction is
 * rolled back automatically.
 */

import { NextResponse } from 'next/server';
import type { DbClient } from '@/drizzle/db';
import { apiError } from '@/lib/api-error';
import { sql } from 'drizzle-orm';

export interface TransactionOptions {
  /** Maximum retries on serialization failure (default: 2) */
  maxRetries?: number;
  /** Statement timeout in ms applied inside the transaction (default: 15000) */
  timeoutMs?: number;
  /** Label for logs/Sentry (default: 'api-transaction') */
  label?: string;
}

// PostgreSQL serialization failure error code
const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

interface PgError {
  code?: string;
}

function isRetryable(err: unknown): boolean {
  const pgErr = err as PgError;
  return pgErr?.code === SERIALIZATION_FAILURE || pgErr?.code === DEADLOCK_DETECTED;
}

/**
 * Execute a multi-write handler inside a database transaction.
 *
 * @param dbClient - The Drizzle database client
 * @param handler - Async function receiving the transaction client, must return NextResponse
 * @param options - Configuration for retries, timeout, and labeling
 * @returns NextResponse from the handler, or an error response on failure
 */
export async function withTransaction(
  dbClient: DbClient,
  handler: (tx: DbClient) => Promise<NextResponse>,
  options: TransactionOptions = {},
): Promise<NextResponse> {
  const { maxRetries = 2, timeoutMs = 15_000, label = 'api-transaction' } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await dbClient.transaction(async (tx) => {
        // Set per-transaction timeout (scoped — doesn't leak to pool)
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${timeoutMs}'`));

        return handler(tx as unknown as DbClient);
      });

      return result;
    } catch (err) {
      lastError = err;

      if (isRetryable(err) && attempt < maxRetries) {
        // Brief backoff before retry (exponential: 50ms, 100ms)
        await sleep(50 * (attempt + 1));
        continue;
      }

      // Non-retryable or exhausted retries
      break;
    }
  }

  // All attempts failed
  return apiError(lastError, `Transaction failed: ${label}`, 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
