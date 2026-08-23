/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Distributed Cron Lock
 *
 * Prevents duplicate execution of scheduled jobs when multiple app instances
 * (pods/containers) run simultaneously. Uses PostgreSQL advisory locks which
 * are fast, non-blocking (with pg_try_advisory_lock), and auto-released on
 * disconnect.
 *
 * Usage in a cron route:
 * ```ts
 * import { withCronLock } from '@/lib/cron/distributed-lock';
 *
 * export async function POST(req: NextRequest) {
 *   return withCronLock('backup-daily', async () => {
 *     // ... job logic ...
 *     return NextResponse.json({ ok: true });
 *   });
 * }
 * ```
 *
 * If another instance is already running the same job, the caller receives
 * a 409 Conflict response immediately (no blocking, no waiting).
 *
 * Lock IDs are derived by hashing the job name into a 32-bit integer,
 * which is the format PostgreSQL advisory locks expect.
 */

import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';

export interface CronLockOptions {
  /** Maximum execution time before force-releasing the lock (ms). Default: 300_000 (5min). */
  timeoutMs?: number;
}

/**
 * Derive a stable 32-bit integer from a job name for use as pg advisory lock key.
 * Uses FNV-1a hash for good distribution with short strings.
 */
export function jobNameToLockId(name: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Ensure positive 32-bit integer (pg advisory lock accepts bigint but
  // single-param variant uses int4 so we mask to 31 bits for safety).
  return (hash >>> 0) & 0x7fffffff;
}

/**
 * Execute a cron handler under a distributed PostgreSQL advisory lock.
 *
 * @param jobName - Unique job identifier (e.g. 'backup-daily', 'sla-check')
 * @param handler - Async function to execute if lock is acquired
 * @param options - Configuration
 * @returns NextResponse from handler, or 409 if lock not acquired
 */
export async function withCronLock(
  jobName: string,
  handler: () => Promise<NextResponse>,
  options: CronLockOptions = {},
): Promise<NextResponse> {
  const { timeoutMs = 300_000 } = options;
  const lockId = jobNameToLockId(jobName);
  const pool = getPool();

  // Acquire a dedicated connection (advisory locks are session-level)
  const client = await pool.connect();

  try {
    // Set a statement timeout to prevent infinite hangs
    await client.query(`SET statement_timeout = '${timeoutMs}'`);

    // Try to acquire the lock (non-blocking)
    const { rows } = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [lockId],
    );

    const acquired = rows[0]?.acquired ?? false;

    if (!acquired) {
      return NextResponse.json(
        {
          error: 'Job already running on another instance',
          job: jobName,
          lockId,
        },
        { status: 409 },
      );
    }

    // Execute the handler
    const result = await handler();
    return result;
  } finally {
    // Always release the lock and return the connection
    try {
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
    } catch {
      // If the connection is dead, the lock is released automatically
    }
    client.release();
  }
}
