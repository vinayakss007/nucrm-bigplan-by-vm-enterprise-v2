/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Connection pool warm-up.
 *
 * On cold start (new container, deploy, restart), the pg Pool starts empty.
 * The first N requests all compete to open connections simultaneously, causing
 * a latency spike while TCP + TLS + auth happens in parallel. This is
 * especially visible behind PgBouncer where connection creation is serialised.
 *
 * warmPool() pre-establishes a configurable number of connections by acquiring
 * and immediately releasing them before the readiness probe goes healthy. The
 * pool then starts with idle connections ready to serve queries instantly.
 *
 * Called from instrumentation.ts after registerShutdownHandlers() so the pool
 * is warm before the first user request arrives.
 *
 * Usage:
 *   import { warmPool } from '@/lib/db/warmup';
 *   await warmPool(); // blocks until warm or timeout
 */

import { getPool } from './pool';

/**
 * Pre-establish connections by acquiring and releasing clients.
 *
 * @param count - Number of connections to warm (default: min(poolSize/2, 5))
 * @param timeoutMs - Max time to spend warming before giving up (default: 10s)
 * @returns Number of connections successfully warmed
 */
export async function warmPool(count?: number, timeoutMs = 10_000): Promise<number> {
  const pool = getPool();
  const poolMax = (pool as unknown as { options?: { max?: number } }).options?.max ?? 20;
  const target = count ?? Math.min(Math.ceil(poolMax / 2), 5);

  const deadline = Date.now() + timeoutMs;
  let warmed = 0;

  // Acquire connections in parallel (up to target), then release them.
  const promises = Array.from({ length: target }, async () => {
    if (Date.now() > deadline) return false;
    try {
      const client = await pool.connect();
      // Run a trivial query to ensure the connection is fully established
      // (not just TCP-connected but also authenticated and ready).
      await client.query('SELECT 1');
      client.release();
      warmed++;
      return true;
    } catch (err) {
      console.warn('[pool-warmup] Failed to warm a connection:', err instanceof Error ? err.message : err);
      return false;
    }
  });

  await Promise.allSettled(promises);

  if (warmed > 0) {
    console.log(`[pool-warmup] Warmed ${warmed}/${target} connections (pool max: ${poolMax})`);
  } else {
    console.warn('[pool-warmup] Could not warm any connections — DB may be unreachable');
  }

  return warmed;
}
