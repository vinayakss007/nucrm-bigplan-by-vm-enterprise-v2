/**
 * Cron Health Registry
 *
 * A bounded, in-memory registry of recent cron job executions.
 * Provides a "dead-man switch" capability: if a job hasn't reported
 * in within its expected interval, it is considered stale/stuck.
 *
 * Usage in cron route handlers:
 *   import { registerCronRun } from '@/lib/cron/health';
 *   registerCronRun('invoice-reminders', { durationMs: 230, status: 'ok' });
 *
 * The /api/system/cron-health endpoint reads this registry.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CronRunRecord {
  jobName: string;
  lastRunAt: number; // Date.now() epoch ms
  durationMs: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface CronHealthEntry extends CronRunRecord {
  /** True if the job hasn't run within maxAgeMs of the last check. */
  stale: boolean;
}

// ─── Bounded Registry ────────────────────────────────────────────────────────

const MAX_ENTRIES = 50;
const registry = new Map<string, CronRunRecord>();

/**
 * Record a cron job execution. Overwrites the previous record for the same job.
 * If the registry exceeds MAX_ENTRIES, the oldest entry is evicted.
 */
export function registerCronRun(
  jobName: string,
  opts: { durationMs: number; status: 'ok' | 'error'; error?: string }
): void {
  // Evict oldest entry if at capacity and this is a new key
  if (!registry.has(jobName) && registry.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of registry) {
      if (entry.lastRunAt < oldestTime) {
        oldestTime = entry.lastRunAt;
        oldestKey = key;
      }
    }
    if (oldestKey) registry.delete(oldestKey);
  }

  registry.set(jobName, {
    jobName,
    lastRunAt: Date.now(),
    durationMs: opts.durationMs,
    status: opts.status,
    error: opts.error,
  });
}

/**
 * Returns all cron health entries with a stale flag.
 * @param maxAgeMs - Threshold in ms after which a job is considered stale.
 *                   Defaults to 15 minutes (900000ms).
 */
export function getCronHealth(maxAgeMs = 900_000): CronHealthEntry[] {
  const now = Date.now();
  const entries: CronHealthEntry[] = [];
  for (const record of registry.values()) {
    entries.push({
      ...record,
      stale: now - record.lastRunAt > maxAgeMs,
    });
  }
  return entries;
}

/**
 * Returns only jobs that are stale (haven't run within the threshold).
 */
export function getStaleJobs(maxAgeMs = 900_000): CronHealthEntry[] {
  return getCronHealth(maxAgeMs).filter(e => e.stale);
}

/**
 * Clear the registry. Useful for testing.
 */
export function resetCronHealth(): void {
  registry.clear();
}
