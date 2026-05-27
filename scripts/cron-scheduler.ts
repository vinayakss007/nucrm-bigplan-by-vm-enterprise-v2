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
 * Usage:
 *   npx tsx scripts/cron-scheduler.ts
 *   pm2 start ecosystem.config.js --only cron
 */

const APP_URL = process.env['NEXT_PUBLIC_APP_URL'] || process.env['APP_URL'] || 'http://localhost:3000';
const CRON_SECRET = process.env['CRON_SECRET'] || '';

if (!CRON_SECRET) {
  console.error('[cron-scheduler] FATAL: CRON_SECRET is required');
  process.exit(1);
}

interface CronJob {
  name: string;
  path: string;
  schedule: string; // simplified: interval in ms
  intervalMs: number;
  lastRun?: number;
}

// Mirror of vercel.json crons + subscription-check
const JOBS: CronJob[] = [
  { name: 'process-sequences',   path: '/api/cron/process-sequences',   schedule: '*/5 * * * *',       intervalMs: 5 * 60_000 },
  { name: 'retry-webhooks',      path: '/api/cron/retry-webhooks',      schedule: '*/10 * * * *',      intervalMs: 10 * 60_000 },
  { name: 'task-reminders',      path: '/api/cron/task-reminders',      schedule: '0 * * * *',         intervalMs: 60 * 60_000 },
  { name: 'trial-check',         path: '/api/cron/trial-check',         schedule: '0 0 * * *',         intervalMs: 24 * 60 * 60_000 },
  { name: 'usage-snapshot',      path: '/api/cron/usage-snapshot',      schedule: '0 0 * * 0',         intervalMs: 7 * 24 * 60 * 60_000 },
  { name: 'auto-backup',         path: '/api/cron/auto-backup',         schedule: '0 2 * * *',         intervalMs: 24 * 60 * 60_000 },
  { name: 'backup-health',       path: '/api/cron/backup-health',       schedule: '0 3 * * 0',         intervalMs: 7 * 24 * 60 * 60_000 },
  { name: 'cleanup',             path: '/api/cron/cleanup',             schedule: '0 4 * * 0',         intervalMs: 7 * 24 * 60 * 60_000 },
  { name: 'warmup-emails',       path: '/api/cron/warmup-emails',       schedule: '0 9,13,17 * * *',   intervalMs: 4 * 60 * 60_000 },
  { name: 'subscription-check',  path: '/api/cron/subscription-check',  schedule: '0 5 * * *',         intervalMs: 24 * 60 * 60_000 },
];

async function runJob(job: CronJob): Promise<void> {
  const url = `${APP_URL}${job.path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-cron-secret': CRON_SECRET,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(120_000), // 2 min timeout
    });

    if (res.ok) {
      console.log(`[cron] ✓ ${job.name} (${res.status})`);
    } else {
      const text = await res.text().catch(() => '');
      console.error(`[cron] ✗ ${job.name} — HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (err: any) {
    console.error(`[cron] ✗ ${job.name} — ${err.message}`);
  }
  job.lastRun = Date.now();
}

function shouldRun(job: CronJob): boolean {
  if (!job.lastRun) return true;
  return (Date.now() - job.lastRun) >= job.intervalMs;
}

// Main loop — check every 30 seconds if any job is due
const TICK_INTERVAL = 30_000;

console.log(`[cron-scheduler] Started. ${JOBS.length} jobs registered.`);
console.log(`[cron-scheduler] App URL: ${APP_URL}`);
console.log(`[cron-scheduler] Tick interval: ${TICK_INTERVAL / 1000}s`);

// Stagger initial runs so they don't all fire at once on startup
for (let i = 0; i < JOBS.length; i++) {
  JOBS[i]!.lastRun = Date.now() - JOBS[i]!.intervalMs + (i * 10_000);
}

const tickInterval = setInterval(async () => {
  for (const job of JOBS) {
    if (shouldRun(job)) {
      // Fire and forget — don't block other jobs
      runJob(job).catch(() => {});
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
