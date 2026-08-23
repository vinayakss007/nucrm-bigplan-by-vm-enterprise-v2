/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Slow Query Detection
 *
 * Wraps database queries to detect and log slow operations.
 * Any query exceeding the threshold is logged with full context
 * for performance debugging.
 *
 * Usage:
 * ```ts
 * const result = await trackQuery('contacts.list', () =>
 *   db.select().from(contacts).where(...)
 * );
 * ```
 */

const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_THRESHOLD_MS || '200');

interface SlowQueryEntry {
  operation: string;
  durationMs: number;
  timestamp: string;
  tenantId?: string;
}

// Ring buffer for recent slow queries (last 100)
const slowQueryLog: SlowQueryEntry[] = [];
const MAX_LOG_SIZE = 100;

/**
 * Execute a query and log if it exceeds the slow threshold.
 */
export async function trackQuery<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: { tenantId?: string }
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = Math.round(performance.now() - start);
    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      const entry: SlowQueryEntry = {
        operation,
        durationMs,
        timestamp: new Date().toISOString(),
        tenantId: context?.tenantId,
      };
      slowQueryLog.push(entry);
      if (slowQueryLog.length > MAX_LOG_SIZE) slowQueryLog.shift();

      // Log to stderr for log aggregation pickup
      console.warn(`[SLOW_QUERY] ${operation} took ${durationMs}ms`, entry);
    }
  }
}

/**
 * Get recent slow queries for monitoring dashboard.
 */
export function getSlowQueries(): SlowQueryEntry[] {
  return [...slowQueryLog];
}

/**
 * Get slow query stats.
 */
export function getSlowQueryStats(): {
  total: number;
  avgMs: number;
  maxMs: number;
  topOperations: Array<{ operation: string; count: number; avgMs: number }>;
} {
  if (slowQueryLog.length === 0) {
    return { total: 0, avgMs: 0, maxMs: 0, topOperations: [] };
  }

  const total = slowQueryLog.length;
  const avgMs = Math.round(slowQueryLog.reduce((sum, e) => sum + e.durationMs, 0) / total);
  const maxMs = Math.max(...slowQueryLog.map(e => e.durationMs));

  // Group by operation
  const byOp = new Map<string, { count: number; totalMs: number }>();
  for (const entry of slowQueryLog) {
    const existing = byOp.get(entry.operation) || { count: 0, totalMs: 0 };
    existing.count++;
    existing.totalMs += entry.durationMs;
    byOp.set(entry.operation, existing);
  }

  const topOperations = [...byOp.entries()]
    .map(([operation, { count, totalMs }]) => ({
      operation,
      count,
      avgMs: Math.round(totalMs / count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { total, avgMs, maxMs, topOperations };
}
