/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Connection leak detector.
 *
 * Tracks acquired pool clients and alerts when one has been held without
 * release for longer than a threshold. This catches the most common pool
 * exhaustion bug: a code path calls pool.connect() then throws before calling
 * client.release(), and the connection is lost until the idle timeout fires
 * (which may be minutes or never, depending on pool config).
 *
 * Usage:
 *   import { trackClient, releaseClient, getLeakedConnections } from '@/lib/db/leak-detector';
 *
 *   const client = await pool.connect();
 *   const id = trackClient(new Error('acquired here')); // capture stack
 *   try {
 *     await client.query(...);
 *   } finally {
 *     client.release();
 *     releaseClient(id);
 *   }
 *
 * In production, the safe-connection wrapper (lib/db/safe-connection.ts)
 * should integrate this automatically so individual call sites don't need to
 * remember.
 *
 * The detector runs a periodic sweep (every 30s) and logs leaked connections
 * with their acquisition stack trace so the offending code path is identifiable
 * without a debugger.
 */

let _nextId = 1;
const _tracked = new Map<number, { acquiredAt: number; stack: string }>();
let _timer: ReturnType<typeof setInterval> | null = null;
let _started = false;

const LEAK_THRESHOLD_MS = parseInt(process.env.DB_LEAK_THRESHOLD_MS ?? '30000');
const SWEEP_INTERVAL_MS = 30_000;

/**
 * Track a newly acquired client. Returns an ID to pass to releaseClient().
 *
 * @param stackError - Pass `new Error()` at the call site so the stack trace
 *   shows WHERE the connection was acquired, not where the leak was detected.
 */
export function trackClient(stackError?: Error): number {
  const id = _nextId++;
  _tracked.set(id, {
    acquiredAt: Date.now(),
    stack: stackError?.stack ?? new Error('acquired').stack ?? '',
  });
  return id;
}

/**
 * Mark a client as released. Call in the finally block after client.release().
 */
export function releaseClient(id: number): void {
  _tracked.delete(id);
}

/**
 * Get all connections currently held longer than the threshold.
 * Useful for the health endpoint and manual inspection.
 */
export function getLeakedConnections(): {
  id: number;
  heldMs: number;
  acquiredAt: number;
  stack: string;
}[] {
  const now = Date.now();
  const leaked: ReturnType<typeof getLeakedConnections> = [];

  for (const [id, info] of _tracked) {
    const heldMs = now - info.acquiredAt;
    if (heldMs > LEAK_THRESHOLD_MS) {
      leaked.push({ id, heldMs, acquiredAt: info.acquiredAt, stack: info.stack });
    }
  }

  return leaked;
}

/**
 * Get the count of currently tracked (unreleased) connections.
 */
export function getTrackedCount(): number {
  return _tracked.size;
}

/**
 * Start the periodic sweep that logs leaked connections.
 * Idempotent. Auto-starts on first import in non-test environments.
 */
export function startLeakDetector(): void {
  if (_started) return;
  _started = true;

  _timer = setInterval(() => {
    const leaked = getLeakedConnections();
    if (leaked.length > 0) {
      for (const leak of leaked) {
        console.error(
          `[db-leak-detector] Connection held for ${Math.round(leak.heldMs / 1000)}s without release.\n` +
            `  Acquired at: ${new Date(leak.acquiredAt).toISOString()}\n` +
            `  Stack: ${leak.stack.split('\n').slice(1, 5).join('\n    ')}`
        );
      }
      console.error(
        `[db-leak-detector] ${leaked.length} potential leak(s) detected. ` +
          `Total unreleased: ${_tracked.size}`
      );
    }
  }, SWEEP_INTERVAL_MS);

  if (_timer.unref) _timer.unref();
}

/** Stop the detector. For testing and graceful shutdown. */
export function stopLeakDetector(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _started = false;
}

/** Reset all state. For testing. */
export function resetLeakDetector(): void {
  stopLeakDetector();
  _tracked.clear();
  _nextId = 1;
}

// Auto-start in non-test environments
if (process.env.NODE_ENV !== 'test') {
  startLeakDetector();
}
