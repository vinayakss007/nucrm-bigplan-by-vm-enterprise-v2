/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { summarizeCronHealth, type CronJobRunSummary } from '@/lib/cron/health';
import { CRON_JOBS, scheduledJobs } from '@/lib/cron/jobs';

// #3410 PR-2C proof, verbatim: "a job in the manifest with no cron_runs row
// yields status: 'never_run', and the endpoint's overall health is fail, not
// pass with a warning." summarizeCronHealth is pure — no DB, injected clock —
// which is what lets the whole contract be tested without a database.

const NOW = new Date('2026-11-01T12:00:00Z').getTime();
const SCHEDULED = scheduledJobs();

function healthyRows(): CronJobRunSummary[] {
  return SCHEDULED.map((job) => ({
    job: job.name,
    lastRunAtMs: NOW - 60_000,
    lastRunOk: true,
    lastRunError: null,
    lastSuccessAtMs: NOW - 60_000,
  }));
}

describe('summarizeCronHealth (#3410)', () => {
  it('a fully healthy fleet with tracked orphans reads degraded, never fail', () => {
    const report = summarizeCronHealth(healthyRows(), NOW);
    expect(report.status).toBe('degraded');
    expect(report.neverRun).toEqual([]);
    expect(report.stale).toEqual([]);
    expect(report.unscheduled.sort()).toEqual(
      CRON_JOBS.filter((j) => !j.sources.crontab && !j.sources.vercel && !j.sources.scheduler)
        .map((j) => j.name)
        .sort(),
    );
  });

  it('a scheduled job with NO cron_runs row is never_run and fails the verdict', () => {
    const rows = healthyRows().filter((r) => r.job !== 'trial-check');
    const report = summarizeCronHealth(rows, NOW);
    const entry = report.jobs.find((j) => j.job === 'trial-check')!;
    expect(entry.status).toBe('never_run');
    expect(entry.lastRunAt).toBeNull();
    expect(report.neverRun).toEqual(['trial-check']);
    expect(report.status).toBe('fail');
  });

  it('a job whose newest row is a refusal is still healthy if a success is recent', () => {
    // A 423 skip is an ATTEMPT row (ok:false); the verdict follows the last
    // SUCCESS, so a skipped duplicate fire must not look like an outage.
    const rows = healthyRows().map((r) =>
      r.job === 'process-sequences'
        ? { ...r, lastRunAtMs: NOW - 10_000, lastRunOk: false, lastRunError: 'skipped: lock-held' }
        : r,
    );
    const report = summarizeCronHealth(rows, NOW);
    expect(report.jobs.find((j) => j.job === 'process-sequences')!.status).toBe('ok');
    expect(report.status).toBe('degraded');
  });

  it('a job with attempts but no success in its expected window is stale', () => {
    const job = SCHEDULED.find((j) => j.name === 'auto-backup')!;
    const rows = healthyRows().map((r) =>
      r.job === 'auto-backup'
        ? { ...r, lastSuccessAtMs: NOW - job.expectedEveryMs - 60_000 }
        : r,
    );
    const report = summarizeCronHealth(rows, NOW);
    expect(report.jobs.find((j) => j.job === 'auto-backup')!.status).toBe('stale');
    expect(report.stale).toContain('auto-backup');
    expect(report.status).toBe('fail');
  });

  it('?maxAgeMs slack can cover lateness but can NEVER mask a never_run (#2766 carry-over)', () => {
    const rows = healthyRows().filter((r) => r.job !== 'trial-check');
    const report = summarizeCronHealth(rows, NOW, 86_400_000);
    expect(report.jobs.find((j) => j.job === 'trial-check')!.status).toBe('never_run');
    expect(report.status).toBe('fail');
  });

  it('a junk slack value (NaN) degrades to the manifest arithmetic, not to all-green', () => {
    const rows = healthyRows().map((r) => ({ ...r, lastSuccessAtMs: NOW - 7 * 24 * 3600_000 }));
    const report = summarizeCronHealth(rows, NOW, Number.NaN);
    expect(report.stale.length).toBeGreaterThan(0);
    expect(report.status).toBe('fail');
  });

  it('unscheduled jobs are never counted as never_run — they are a named decision', () => {
    const report = summarizeCronHealth([], NOW);
    for (const name of ['sla-check', 'process-lead-scoring']) {
      expect(report.jobs.find((j) => j.job === name)!.status).toBe('unscheduled');
    }
    expect(report.neverRun).not.toContain('sla-check');
  });
});
