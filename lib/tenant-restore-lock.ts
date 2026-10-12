/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Per-tenant restore lock (#2225).
 *
 * A tenant restore must never run twice at the same time: two interleaved
 * delete+import passes double-insert rows and can wipe data the second
 * restore is meant to be recovering. PostgreSQL advisory locks give a cheap,
 * cross-instance mutex with no schema changes:
 *
 *  - `acquireTenantRestoreLock` takes a SESSION-level try-lock on a dedicated
 *    pooled connection so the route can answer 409 immediately, while the
 *    background restore keeps the connection (and thus the lock) until it
 *    finishes and calls `releaseTenantRestoreLock` in its finally block.
 *  - The restore transaction itself additionally takes the same key with
 *    `pg_try_advisory_xact_lock` (see `TenantDataImporter.restore`), so even
 *    two callers that race past the session-lock check can never interleave
 *    their wipe+import — the loser's transaction rolls back untouched.
 *
 * Lock IDs are derived by hashing a namespaced key into a 32-bit integer via
 * the same FNV helper the cron distributed lock uses.
 */
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db/pool';
import { jobNameToLockId } from '@/lib/cron/distributed-lock';

/**
 * Thrown when another restore already holds the per-tenant advisory lock.
 * The transaction that raises it is rolled back, so no data is touched.
 */
export class TenantRestoreConflictError extends Error {
  constructor(tenantId: string) {
    super(`A restore is already running for tenant ${tenantId}`);
    this.name = 'TenantRestoreConflictError';
  }
}

/**
 * Stable advisory-lock key for a tenant's restore. Namespaced per operation
 * so it can't collide with a cron job or another lock user.
 */
export function tenantRestoreLockId(tenantId: string): number {
  return jobNameToLockId(`tenant-restore:${tenantId}`);
}

export interface TenantRestoreLock {
  client: PoolClient;
  lockId: number;
}

/**
 * Acquire the SESSION-level per-tenant restore lock on a dedicated pooled
 * connection. Returns null (fail-fast) when another restore for the same
 * tenant holds it — live in this or any other app instance. The lock survives
 * until `releaseTenantRestoreLock` runs or the connection dies, so a crashed
 * process can never wedge a tenant in "restoring" state: Postgres drops
 * session locks on disconnect.
 */
export async function acquireTenantRestoreLock(
  tenantId: string,
): Promise<TenantRestoreLock | null> {
  const client = await getPool().connect();
  const lockId = tenantRestoreLockId(tenantId);
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId],
    );
    if (!rows[0]?.acquired) return null;
    return { client, lockId };
  } catch (err) {
    client.release();
    throw err;
  }
}

/** Release a lock previously acquired via `acquireTenantRestoreLock`. */
export async function releaseTenantRestoreLock(lock: TenantRestoreLock): Promise<void> {
  try {
    await lock.client.query('SELECT pg_advisory_unlock($1)', [lock.lockId]);
  } catch {
    // Connection already dead — Postgres released the lock on disconnect.
  } finally {
    lock.client.release();
  }
}
