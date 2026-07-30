/**
 * Graceful Shutdown Handler
 *
 * Handles SIGTERM/SIGINT to:
 * 1. Stop accepting new connections
 * 2. Wait for active queries to complete (up to timeout)
 * 3. Close the database pool cleanly
 * 4. Exit with code 0
 *
 * Usage: import this module in instrumentation.ts or server startup.
 */

import { db } from '@/drizzle/db';

const SHUTDOWN_TIMEOUT_MS = 15_000; // 15 seconds max wait

let isShuttingDown = false;

/**
 * Check if the process is shutting down.
 * Use this in request handlers to reject new work during shutdown.
 */
export function isProcessShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Initialize graceful shutdown handlers.
 * Call once at app startup (e.g., in instrumentation.ts).
 */
export function initGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return; // Prevent double-shutdown
    isShuttingDown = true;

    console.log(`[shutdown] Received ${signal}. Starting graceful shutdown...`);

    // Give active requests time to finish
    const timeout = setTimeout(() => {
      console.error('[shutdown] Timeout exceeded, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      // Close database pool
      // Drizzle with node-postgres: pool.end() waits for active queries
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pool = (db as any)?._.session?.client;
      if (pool?.end) {
        console.log('[shutdown] Draining database pool...');
        await pool.end();
        console.log('[shutdown] Database pool closed');
      }

      // Close Redis connections if available
      try {
        // Close any global Redis instance
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const globalRedis = (globalThis as any).__redis;
        if (globalRedis?.quit) {
          await globalRedis.quit();
          console.log('[shutdown] Redis connection closed');
        }
      } catch {
        // Redis not available or already closed
      }

      clearTimeout(timeout);
      console.log('[shutdown] Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[shutdown] Error during shutdown:', err);
      clearTimeout(timeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
