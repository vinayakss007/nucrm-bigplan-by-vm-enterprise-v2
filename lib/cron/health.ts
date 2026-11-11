/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { CRON_JOBS } from './jobs';

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

// ── Durable health: the manifest vs the cron_runs ledger (#3410) ─────────────
//
// The in-memory registry above can only ever answer "what has THIS process
// seen since boot". The functions below answer "has this job ever run", by
// comparing lib/cron/jobs.ts against the rows instrumentCronRun writes into
// cron_runs. A scheduled job with no row is `never_run` — as loud as stale —
// and the overall verdict is `fail`, not a pass with a warning.

// (cron_runs comparison lives at the bottom of this file, #3410.)

/** One job's collapsed ledger rows, as fetched by /api/system/cron-health. */
export interface CronJobRunSummary {
  job: string;
  /** Epoch ms of the most recent attempt (row with the greatest started_at). */
  lastRunAtMs: number;
  lastRunOk: boolean;
  lastRunError: string | null;
  /** Epoch ms of the most recent SUCCESSFUL run, or null if there was none. */
  lastSuccessAtMs: number | null;
}

export type CronJobHealthStatus = 'ok' | 'stale' | 'never_run' | 'unscheduled';
export type CronFleetVerdict = 'healthy' | 'degraded' | 'fail';

export interface CronManifestHealthEntry {
  job: string;
  owner: string;
  path: string;
  cron: string;
  expectedEveryMs: number;
  scheduledIn: string[];
  status: CronJobHealthStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface CronManifestHealthReport {
  status: CronFleetVerdict;
  jobs: CronManifestHealthEntry[];
  neverRun: string[];
  stale: string[];
  unscheduled: string[];
  counts: Record<CronJobHealthStatus, number>;
}

/**
 * Pure verdict — no DB, no clock beyond the injected `nowMs`, which is what
 * makes "a manifest job with no cron_runs row yields never_run" a unit test.
 *
 * `maxAgeSlackMs` is the ?maxAgeMs query parameter from #2766, re-scoped: it
 * can only ever TOLERATE more lateness (the stale threshold is
 * max(expectedEveryMs, slack)), never invent a stricter one, and a junk value
 * falls back to 0 — the manifest's own arithmetic. That keeps #2766's promise
 * (a typo in the query string must not flip the monitor off) without letting
 * the query string mask a job that has never run at all.
 */
export function summarizeCronHealth(
  rows: readonly CronJobRunSummary[],
  nowMs: number = Date.now(),
  maxAgeSlackMs = 0,
): CronManifestHealthReport {
  const slack = Number.isFinite(maxAgeSlackMs) && maxAgeSlackMs > 0 ? maxAgeSlackMs : 0;
  const byJob = new Map(rows.map((r) => [r.job, r]));
  const jobs: CronManifestHealthEntry[] = [];

  for (const spec of CRON_JOBS) {
    const scheduledIn = (['crontab', 'vercel', 'scheduler'] as const)
      .filter((source) => spec.sources[source]);
    const row = byJob.get(spec.name);
    let status: CronJobHealthStatus;
    if (scheduledIn.length === 0) {
      status = 'unscheduled';
    } else if (!row) {
      status = 'never_run';
    } else {
      const threshold = Math.max(spec.expectedEveryMs, slack);
      status =
        row.lastSuccessAtMs === null || nowMs - row.lastSuccessAtMs > threshold
          ? 'stale'
          : 'ok';
    }
    jobs.push({
      job: spec.name,
      owner: spec.owner,
      path: spec.path,
      cron: spec.cron,
      expectedEveryMs: spec.expectedEveryMs,
      scheduledIn,
      status,
      lastRunAt: row ? new Date(row.lastRunAtMs).toISOString() : null,
      lastSuccessAt: row?.lastSuccessAtMs != null ? new Date(row.lastSuccessAtMs).toISOString() : null,
      lastError: row?.lastRunError ?? null,
    });
  }

  const counts: Record<CronJobHealthStatus, number> = { ok: 0, stale: 0, never_run: 0, unscheduled: 0 };
  for (const j of jobs) counts[j.status] += 1;
  const neverRun = jobs.filter((j) => j.status === 'never_run').map((j) => j.job);
  const stale = jobs.filter((j) => j.status === 'stale').map((j) => j.job);
  const unscheduled = jobs.filter((j) => j.status === 'unscheduled').map((j) => j.job);
  const status: CronFleetVerdict =
    neverRun.length || stale.length ? 'fail' : unscheduled.length ? 'degraded' : 'healthy';

  return { status, jobs, neverRun, stale, unscheduled, counts };
}
