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
  /**
   * When true (the default), the SIGTERM/SIGINT handler calls `process.exit(0)`
   * after a successful drain. This lives here (a Node-only module) rather than
   * in the caller so `process.exit` never appears in `instrumentation.ts`, which
   * Next.js also bundles for the Edge runtime (where `process.exit` is
   * unsupported and triggers "A Node.js API is used" build warnings). Set false
   * in tests to keep the process alive.
   *
   * `instrumentation.ts` sets it false (PP-029): the Next.js server process owns
   * its own signal handler, awaits `server.close()` for every open connection and
   * exits 143, so exiting here first would pre-empt a drain that is strictly
   * better informed than ours. Verified live: with the flag false, a request that
   * was 1 s into its 3.8 s handler at SIGTERM still returned 200, and the process
   * exited 143 2.7 s later. True is the right default for any caller that owns its
   * process lifecycle outright — today there is none: `worker.ts:667` and
   * `realtime.ts:224` install their own handlers and never reach this module.
   */
  exitProcess?: boolean;
  /**
   * When true (the default), a successful drain calls `pool.end()`.
   *
   * `instrumentation.ts` sets it false (PP-029) for two reasons, one measured and
   * one observed-but-unexplained.
   *
   * Measured: `pool.end()` has no timeout of its own — pg-pool waits for every
   * *checked-out* client — so on a process whose connections belong to Next.js it
   * is a hang rather than a cleanup. A preprod stop took 35.93 s for exactly that
   * reason, with two leaked connections holding it open.
   *
   * Observed: every drain logs `0 in-flight request(s)` even with several wrapped
   * handlers provably mid-request (PP-028's 200 ms statements make a request last
   * seconds, and the stop was timed inside one). Why the increments do not reach
   * this module's copy of `inFlightCount` is **not established** — the server
   * bundle carries the shutdown text in a single chunk, so plain duplication is
   * not the proven explanation. The fix deliberately stops depending on the
   * counter instead of guessing at its cause.
   *
   * Leaving the pool open costs nothing here; the sockets die with the process
   * and Postgres/PgBouncer reap the backends. True is right for a process that
   * owns its own exit and therefore needs the polite close.
   */
  endPool?: boolean;
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

  const exitProcess = options.exitProcess !== false;
  const handler = () => {
    initiateShutdown(options)
      .then(() => {
        // Successful drain: exit 0. Done here (Node-only module) so that
        // instrumentation.ts stays free of process.exit and doesn't trip the
        // Edge-runtime bundler.
        if (exitProcess) process.exit(0);
      })
      .catch((err) => {
        console.error('[GracefulShutdown] Shutdown failed:', err);
        if (exitProcess) process.exit(1);
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
  const endPool = options.endPool !== false;

  console.log('[GracefulShutdown] Shutdown initiated. Stopping new requests...');
  onShutdownStart?.();

  shutdownPromise = (async () => {
    // Wait for in-flight queries/requests to finish — but only when this module
    // is the one that has to make them finish. With `endPool: false` the process
    // is Next.js's, and its cleanup is awaiting every open connection on its own
    // copy of the truth (PP-029); waiting here would just stack a second,
    // less-informed drain on top and add latency to the stop for no benefit.
    if (!endPool) {
      console.log(
        `[GracefulShutdown] ${inFlightCount} in-flight request(s) counted here; ` +
          `the Next.js server owns the drain and the exit.`
      );
    } else {
      const deadline = Date.now() + drainTimeoutMs;
      console.log(
        `[GracefulShutdown] Waiting for ${inFlightCount} in-flight request(s) to complete (timeout: ${drainTimeoutMs}ms)...`
      );

      while (inFlightCount > 0 && Date.now() < deadline) {
        await sleep(100);
      }

      if (inFlightCount > 0) {
        console.warn(
          `[GracefulShutdown] Timed out waiting for ${inFlightCount} in-flight request(s). ` +
            `Leaving the pool open — work this module cannot see is still running.`
        );
      } else {
        console.log('[GracefulShutdown] All in-flight requests completed.');
      }
    }

    // Flush telemetry before anything can exit. The Sentry transport batches
    // events and sends them on a timer, so an event captured moments before
    // SIGTERM would otherwise die with the process — and the failure is silent,
    // because logError's forward swallows everything. Bounded so a slow ingest
    // endpoint can never hold the shutdown open past the orchestrator's limit.
    try {
      const Sentry = await import('@sentry/nextjs').catch(() => null);
      if (Sentry?.flush) {
        const flushed = await Sentry.flush(2_000);
        if (!flushed) console.warn('[GracefulShutdown] Sentry flush timed out; buffered events may be lost.');
      }
    } catch (err) {
      console.warn('[GracefulShutdown] Sentry flush failed:', err);
    }

    // Drain the connection pool — but only if this process is ours to close.
    // PP-029: `pool.end()` can never make a running query finish faster; it can
    // only make its next checkout fail, and it has no timeout of its own —
    // pg-pool waits for every checked-out client. On the Next-owned process that
    // is a hang, not a cleanup: a measured stop took 35.93 s for exactly that
    // reason, with two leaked connections holding it open. Ending the pool at a
    // moment like that is also how a redeploy killed `/api/cron/backup`'s pg_dump
    // and `scheduled-report-delivery`'s SMTP mid-flight. Leaving it open costs
    // nothing — the sockets close with the process and Postgres/PgBouncer reap
    // the backends.
    if (!endPool) {
      console.log('[GracefulShutdown] Leaving the connection pool open — the exiting process owns it.');
    } else if (inFlightCount > 0) {
      console.warn(
        `[GracefulShutdown] Skipped pool.end() with ${inFlightCount} request(s) still in flight.`
      );
    } else {
      try {
        const pool = getPool();
        await pool.end();
        console.log('[GracefulShutdown] Connection pool drained.');
      } catch (err) {
        console.error('[GracefulShutdown] Error draining pool:', err);
      }
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
