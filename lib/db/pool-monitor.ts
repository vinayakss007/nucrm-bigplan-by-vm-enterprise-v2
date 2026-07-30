/**
 * Database pool monitor.
 *
 * Samples the pg Pool every N seconds and maintains a ring buffer of stats.
 * This gives operators visibility into connection usage over time — not just a
 * point-in-time snapshot. Useful for detecting:
 *  - Slow connection leaks (totalCount creeping up over hours)
 *  - Saturation (waitingCount > 0 sustained)
 *  - Idle waste (idleCount == max for long periods → pool is oversized)
 *
 * The stats are exposed via getPoolHistory() for the health endpoint and
 * monitoring dashboards.
 *
 * Started automatically when imported, with a 10s default interval.
 * Does NOT require a database query — reads Pool properties directly.
 */

import { getPool } from './pool';

export interface PoolSnapshot {
  timestamp: number;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

const RING_SIZE = 360; // 10s interval × 360 = 1 hour of history
const DEFAULT_INTERVAL_MS = 10_000;

let _history: PoolSnapshot[] = [];
let _timer: ReturnType<typeof setInterval> | null = null;
let _started = false;

function sample(): PoolSnapshot {
  const pool = getPool();
  return {
    timestamp: Date.now(),
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

function record() {
  const snapshot = sample();
  _history.push(snapshot);
  if (_history.length > RING_SIZE) {
    _history = _history.slice(-RING_SIZE);
  }
}

/**
 * Start the pool monitor. Idempotent.
 *
 * Called automatically on first import in production. In tests, call
 * startPoolMonitor() explicitly after setting up the pool mock.
 */
export function startPoolMonitor(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (_started) return;
  _started = true;

  // Take an immediate sample
  try {
    record();
  } catch {
    // Pool may not be ready yet at import time; that's fine.
  }

  _timer = setInterval(() => {
    try {
      record();
    } catch {
      // Pool disconnected during shutdown — stop sampling silently.
      stopPoolMonitor();
    }
  }, intervalMs);

  // Don't keep the process alive just for monitoring
  if (_timer.unref) _timer.unref();
}

/** Stop the monitor. For graceful shutdown and testing. */
export function stopPoolMonitor(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _started = false;
}

/** Reset all history. For testing. */
export function resetPoolHistory(): void {
  _history = [];
}

/**
 * Get the full history ring buffer (up to 1 hour at 10s intervals).
 */
export function getPoolHistory(): readonly PoolSnapshot[] {
  return _history;
}

/**
 * Get the latest snapshot, or null if no samples have been taken.
 */
export function getLatestSnapshot(): PoolSnapshot | null {
  return _history.length > 0 ? _history[_history.length - 1]! : null;
}

/**
 * Compute summary stats over the history window.
 */
export function getPoolSummary(): {
  samples: number;
  windowMinutes: number;
  avg: { total: number; idle: number; waiting: number };
  max: { total: number; idle: number; waiting: number };
  saturationEvents: number;
} | null {
  if (_history.length < 2) return null;

  const first = _history[0]!;
  const last = _history[_history.length - 1]!;
  const windowMinutes = Math.round((last.timestamp - first.timestamp) / 60_000);

  let totalSum = 0, idleSum = 0, waitingSum = 0;
  let totalMax = 0, idleMax = 0, waitingMax = 0;
  let saturationEvents = 0;

  for (const s of _history) {
    totalSum += s.totalCount;
    idleSum += s.idleCount;
    waitingSum += s.waitingCount;
    if (s.totalCount > totalMax) totalMax = s.totalCount;
    if (s.idleCount > idleMax) idleMax = s.idleCount;
    if (s.waitingCount > waitingMax) waitingMax = s.waitingCount;
    if (s.waitingCount > 0 && s.idleCount === 0) saturationEvents++;
  }

  const n = _history.length;
  return {
    samples: n,
    windowMinutes,
    avg: {
      total: Math.round(totalSum / n * 10) / 10,
      idle: Math.round(idleSum / n * 10) / 10,
      waiting: Math.round(waitingSum / n * 10) / 10,
    },
    max: { total: totalMax, idle: idleMax, waiting: waitingMax },
    saturationEvents,
  };
}

// Auto-start in non-test environments
if (process.env.NODE_ENV !== 'test') {
  startPoolMonitor();
}
