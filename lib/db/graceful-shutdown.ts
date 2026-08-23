/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Graceful Shutdown Handler
 *
 * Manages the controlled shutdown of the application:
 * - Stops accepting new requests
 * - Waits for in-flight queries to finish (with timeout)
 * - Drains the connection pool
 * - Logs the shutdown sequence
 */

import { getPool } from '@/lib/db/pool';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface ShutdownOptions {
  /** Maximum time to wait for in-flight queries (ms). Default: 30000 */
  drainTimeoutMs?: number;
  /** Callback invoked when shutdown begins */
  onShutdownStart?: () => void;
  /** Callback invoked when shutdown completes */
  onShutdownComplete?: () => void;
}

// -------------------------------------------------------------------
// Module state
// -------------------------------------------------------------------

let shuttingDown = false;
let inFlightCount = 0;
let shutdownPromise: Promise<void> | null = null;
let handlersRegistered = false;

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

/**
 * Check whether the server is in shutdown mode.
 * Middleware should call this and reject new requests with 503.
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Increment the in-flight request counter.
 * Call at the start of each request/query.
 */
export function trackRequestStart(): void {
  inFlightCount++;
}

/**
 * Decrement the in-flight request counter.
 * Call when a request/query completes.
 */
export function trackRequestEnd(): void {
  inFlightCount--;
  if (inFlightCount < 0) inFlightCount = 0;
}

/**
 * Get current in-flight count (useful for monitoring).
 */
export function getInFlightCount(): number {
  return inFlightCount;
}

/**
 * Register SIGTERM/SIGINT handlers for graceful shutdown.
 * Idempotent: only registers once.
 */
export function registerShutdownHandlers(options: ShutdownOptions = {}): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const handler = () => {
    initiateShutdown(options).catch((err) => {
      console.error('[GracefulShutdown] Shutdown failed:', err);
      process.exit(1);
    });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

/**
 * Initiate graceful shutdown programmatically.
 * Returns a promise that resolves when shutdown is complete.
 */
export async function initiateShutdown(options: ShutdownOptions = {}): Promise<void> {
  // Prevent multiple concurrent shutdowns
  if (shutdownPromise) return shutdownPromise;

  shuttingDown = true;
  const { drainTimeoutMs = 30_000, onShutdownStart, onShutdownComplete } = options;

  console.log('[GracefulShutdown] Shutdown initiated. Stopping new requests...');
  onShutdownStart?.();

  shutdownPromise = (async () => {
    // Wait for in-flight queries/requests to finish
    const deadline = Date.now() + drainTimeoutMs;
    console.log(
      `[GracefulShutdown] Waiting for ${inFlightCount} in-flight request(s) to complete (timeout: ${drainTimeoutMs}ms)...`
    );

    while (inFlightCount > 0 && Date.now() < deadline) {
      await sleep(100);
    }

    if (inFlightCount > 0) {
      console.warn(
        `[GracefulShutdown] Timed out waiting for ${inFlightCount} in-flight request(s). Proceeding with pool drain.`
      );
    } else {
      console.log('[GracefulShutdown] All in-flight requests completed.');
    }

    // Drain the connection pool
    try {
      const pool = getPool();
      await pool.end();
      console.log('[GracefulShutdown] Connection pool drained.');
    } catch (err) {
      console.error('[GracefulShutdown] Error draining pool:', err);
    }

    console.log('[GracefulShutdown] Shutdown complete.');
    onShutdownComplete?.();
  })();

  return shutdownPromise;
}

/**
 * Reset shutdown state. Primarily for testing.
 */
export function resetShutdownState(): void {
  shuttingDown = false;
  inFlightCount = 0;
  shutdownPromise = null;
  handlersRegistered = false;
}

// -------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
