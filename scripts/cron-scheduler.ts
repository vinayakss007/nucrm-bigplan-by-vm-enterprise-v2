#!/usr/bin/env node
/**
 * NuCRM — Self-Hosted Cron Scheduler
 *
 * For deployments WITHOUT external cron (no Vercel, no host crontab).
 * Runs as a single PM2 process (instances: 1) and fires HTTP calls
 * to the app's /api/cron/* endpoints on schedule.
 *
 * This replaces the need for a system crontab or Vercel cron.
 * In Docker deployments, prefer the dedicated `cron` container instead.
 *
 * #3410: the job list and every schedule come from lib/cron/jobs.ts — the
 * one manifest. This process used to re-declare the jobs with an `intervalMs`
 * guess per entry, which quietly disagreed with the crontab it mirrored
 * (warmup-emails: fired every 4h here, 3 fixed hours a day there). It now
 * matches the real cron expressions minute by minute. Adding a job is a
 * manifest edit with `sources.scheduler: true` — nothing changes here.
 *
 * Usage:
 *   npx tsx scripts/cron-scheduler.ts
 *   pm2 start ecosystem.config.js --only cron
 */

import { registerProcessErrorHandlers } from '@/lib/process-errors';
import { cronAuthHeaders } from '@/lib/cron/signature';
import { CRON_JOBS, nextFireAt, type CronJobSpec } from '@/lib/cron/jobs';

registerProcessErrorHandlers('cron-scheduler');

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env['APP_URL'] || 'http://localhost:3000';
const CRON_SECRET = process.env['CRON_SECRET'] || '';

if (!CRON_SECRET) {
  console.error('[cron-scheduler] FATAL: CRON_SECRET is required');
  process.exit(1);
}

interface ScheduledJob {
  spec: CronJobSpec;
  nextFire: number;
  running: boolean;
}

const SCHEDULED: ScheduledJob[] = CRON_JOBS.filter((job) => job.sources.scheduler).map((spec) => ({
  spec,
  nextFire: 0,
  running: false,
}));

if (SCHEDULED.length === 0) {
  console.error('[cron-scheduler] FATAL: the manifest fires no jobs in the scheduler source');
  process.exit(1);
}

async function runJob(job: ScheduledJob): Promise<void> {
  const { spec } = job;
  const url = `${APP_URL}${spec.path}`;
  job.running = true;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...cronAuthHeaders({ secret: CRON_SECRET }),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(spec.maxDurationMs),
    });

    if (res.ok) {
      console.log(`[cron] ✓ ${spec.name} (${res.status})`);
    } else {
      const text = await res.text().catch(() => '');
      // 423 is a deliberate skip (#2539): the lock was held, the job did not
      // run. Loud, but not an outage — the run record says the same thing.
      const mark = res.status === 423 ? '⊘ skipped' : '✗';
      console.error(`[cron] ${mark} ${spec.name} — HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron] ✗ ${spec.name} — ${msg}`);
  } finally {
    job.running = false;
  }
}

// Main loop — check every 15 seconds whether any manifest job's cron
// expression has come due. Cron matching is minute-granular (UTC), so the
// poll interval only bounds lateness, never repeats a fire.
const TICK_INTERVAL = 15_000;

console.log(`[cron-scheduler] Started. ${SCHEDULED.length} jobs from lib/cron/jobs.ts.`);
console.log(`[cron-scheduler] App URL: ${APP_URL}`);
console.log(`[cron-scheduler] Tick interval: ${TICK_INTERVAL / 1000}s`);

const tickInterval = setInterval(() => {
  const now = Date.now();
  for (const job of SCHEDULED) {
    if (job.running) continue;
    if (job.nextFire === 0) {
      const next = nextFireAt(job.spec.cron, new Date(now));
      job.nextFire = next ? next.getTime() : Infinity;
      if (!Number.isFinite(job.nextFire)) {
        console.error(`[cron-scheduler] ✗ ${job.spec.name} — cron "${job.spec.cron}" never matches; check the manifest.`);
      }
    }
    if (now >= job.nextFire) {
      // Compute the following fire before launching, so a slow run cannot
      // retrigger the same minute when it finishes.
      const next = nextFireAt(job.spec.cron, new Date(job.nextFire + 60_000));
      job.nextFire = next ? next.getTime() : Infinity;
      runJob(job).catch((e) => console.error('[cron-scheduler] job failed:', job.spec.name, e));
    }
  }
}, TICK_INTERVAL);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[cron-scheduler] SIGTERM — shutting down');
  clearInterval(tickInterval);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[cron-scheduler] SIGINT — shutting down');
  clearInterval(tickInterval);
  process.exit(0);
});
