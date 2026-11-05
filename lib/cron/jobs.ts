/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The cron manifest — ONE source of truth for every scheduled job (#3410).
 *
 * Before this file a job's schedule was data written three times in three
 * notations: `deploy/cron/crontab` (the VM/production scheduler), the `crons`
 * array in `vercel.json` (Vercel only), and a hand-maintained JOBS array in
 * `scripts/cron-scheduler.ts` (the in-process PM2/Docker alternative). They
 * drifted silently: `recurring-invoice-generator` (revenue) ran on Vercel and
 * nowhere on the VM, `sla-check` and `process-lead-scoring` appeared in none
 * of the three, and `cron-scheduler.ts` approximated every cron expression
 * with an `intervalMs` guess that fired `warmup-emails` six times a day where
 * the crontab fires it three.
 *
 * Each job is declared once here. `scripts/gen-cron-manifest.mts` derives the
 * crontab and the vercel.json `crons` array from this list, and the in-process
 * scheduler fires from the cron expressions themselves (no interval guess).
 * `npm run guard:cron-manifest` re-generates and diffs, so editing a schedule
 * in one place and forgetting the manifest turns the build red instead of
 * turning a job into a rumor.
 *
 * Per #1422 exactly ONE scheduler is active per environment, so a job may
 * legitimately run in one environment and not another — that is what the
 * `sources` flags are for. A flag is a named decision, and flipping one is a
 * one-line manifest edit that lands in a PR diff, not an edit to one of three
 * files that the other two never hear about.
 */

export type CronJobSource = 'crontab' | 'vercel' | 'scheduler';

export interface CronJobSpec {
  /** Directory name under app/api/cron/ and the lock/run record's job name. */
  name: string;
  /** Endpoint path the schedulers POST to. */
  path: string;
  /** The standard five-field crontab expression every scheduler honours. */
  cron: string;
  /** Team/area that owns the job's behaviour, for escalation. */
  owner: string;
  /** Request timeout the in-process scheduler applies; also health's ceiling. */
  maxDurationMs: number;
  /**
   * Longest acceptable gap between SUCCESSFUL runs, as seen by
   * /api/system/cron-health. Set it to the largest interval the cron
   * expression actually produces (warmup-emails fires at 9/13/17 — its
   * expected gap is the 17:00→09:00 overnight span, not 4h).
   */
  expectedEveryMs: number;
  /**
   * Which schedulers fire this job. All-false means the route exists but no
   * environment runs it — an orphan awaiting the #2539-step-3 owner decision
   * (schedule it here, or delete the route). The manifest guard requires any
   * such name to stay in `check-cron-lock.mjs`'s tracked set.
   */
  sources: Record<CronJobSource, boolean>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const CRON_JOBS: readonly CronJobSpec[] = [
  { name: 'process-sequences', path: '/api/cron/process-sequences', cron: '*/5 * * * *', owner: 'email', maxDurationMs: 120_000, expectedEveryMs: 5 * MIN, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'retry-webhooks', path: '/api/cron/retry-webhooks', cron: '*/10 * * * *', owner: 'integrations', maxDurationMs: 120_000, expectedEveryMs: 10 * MIN, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'task-reminders', path: '/api/cron/task-reminders', cron: '0 * * * *', owner: 'crm', maxDurationMs: 120_000, expectedEveryMs: HOUR, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'trial-check', path: '/api/cron/trial-check', cron: '0 0 * * *', owner: 'billing', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'usage-snapshot', path: '/api/cron/usage-snapshot', cron: '0 0 * * 0', owner: 'analytics', maxDurationMs: 120_000, expectedEveryMs: WEEK, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'auto-backup', path: '/api/cron/auto-backup', cron: '0 2 * * *', owner: 'backups', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'backup-health', path: '/api/cron/backup-health', cron: '0 3 * * 0', owner: 'backups', maxDurationMs: 120_000, expectedEveryMs: WEEK, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'backup-verify', path: '/api/cron/backup-verify', cron: '0 4 * * *', owner: 'backups', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'cleanup', path: '/api/cron/cleanup', cron: '0 4 * * 0', owner: 'platform', maxDurationMs: 120_000, expectedEveryMs: WEEK, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'warmup-emails', path: '/api/cron/warmup-emails', cron: '0 9,13,17 * * *', owner: 'email', maxDurationMs: 120_000, expectedEveryMs: 16 * HOUR, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'subscription-check', path: '/api/cron/subscription-check', cron: '0 5 * * *', owner: 'billing', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'detect-missed-followups', path: '/api/cron/detect-missed-followups', cron: '*/30 * * * *', owner: 'crm', maxDurationMs: 120_000, expectedEveryMs: 30 * MIN, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'ai-auto-followup', path: '/api/cron/ai-auto-followup', cron: '0 * * * *', owner: 'ai', maxDurationMs: 120_000, expectedEveryMs: HOUR, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'contract-renewal-check', path: '/api/cron/contract-renewal-check', cron: '0 7 * * *', owner: 'billing', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'process-at-risk', path: '/api/cron/process-at-risk', cron: '0 8 * * *', owner: 'crm', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: true } },
  { name: 'subscription-renewal-check', path: '/api/cron/subscription-renewal-check', cron: '0 7 * * *', owner: 'billing', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: false } },
  { name: 'scheduled-report-delivery', path: '/api/cron/scheduled-report-delivery', cron: '0 8 * * *', owner: 'analytics', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: true, vercel: true, scheduler: false } },
  // The VM omission on `recurring-invoice-generator` and the crontab omission
  // on `backup`/`lead-warming` are #2539 step-3 debt that #3410 tracks —
  // flipping a `sources` flag IS the owner decision, made as a PR diff.
  { name: 'recurring-invoice-generator', path: '/api/cron/recurring-invoice-generator', cron: '0 6 * * *', owner: 'billing', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: false, vercel: true, scheduler: true } },
  { name: 'backup', path: '/api/cron/backup', cron: '30 2 * * *', owner: 'backups', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: false, vercel: false, scheduler: true } },
  { name: 'lead-warming', path: '/api/cron/lead-warming', cron: '0 9 * * *', owner: 'email', maxDurationMs: 120_000, expectedEveryMs: DAY, sources: { crontab: false, vercel: false, scheduler: true } },
  // Orphans below run nowhere; their `cron` is the cadence the owner decision
  // (#2539 step 3, scheduled by #3410) would apply if the job is kept.
  { name: 'process-lead-scoring', path: '/api/cron/process-lead-scoring', cron: '0 * * * *', owner: 'ai', maxDurationMs: 120_000, expectedEveryMs: HOUR, sources: { crontab: false, vercel: false, scheduler: false } },
  { name: 'sla-check', path: '/api/cron/sla-check', cron: '*/10 * * * *', owner: 'support', maxDurationMs: 120_000, expectedEveryMs: 10 * MIN, sources: { crontab: false, vercel: false, scheduler: false } },
] as const;

export function jobByName(name: string): CronJobSpec | undefined {
  return CRON_JOBS.find((job) => job.name === name);
}

/** Jobs fired by at least one scheduler; health reads this to find orphans. */
export function scheduledJobs(): CronJobSpec[] {
  return CRON_JOBS.filter(
    (job) => job.sources.crontab || job.sources.vercel || job.sources.scheduler,
  );
}

// ── cron-expression matching (the in-process scheduler's clock) ──────────────

/**
 * Does this five-field expression fire on `date`'s minute? Supports the field
 * grammar actually used in the manifest: star, star-slash-n (steps), `a-b`
 * ranges, `a,b,c` lists and bare numbers, matched independently per field.
 * Intentionally tiny — every expression here is simple; a complex one should
 * live in the host crontab instead.
 */
export function cronMatchesMinute(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const values = [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    date.getUTCDay(),
  ];
  return fields.every((field, i) => fieldMatches(field, values[i]!));
}

function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    const step = part.match(/^(.+?)\/(\d+)$/);
    if (step) {
      const base = step[1] === '*' ? null : parseRange(step[1]!, value);
      const n = Number(step[2]);
      if (!Number.isInteger(n) || n <= 0) return false;
      if (value % n !== 0) return false;
      return base === null || base;
    }
    return parseRange(part, value);
  });
}

function parseRange(part: string, value: number): boolean {
  if (part === '*') return true;
  const range = part.match(/^(\d+)-(\d+)$/);
  if (range) return value >= Number(range[1]) && value <= Number(range[2]);
  return /^\d+$/.test(part) && Number(part) === value;
}

/**
 * Next minute (inclusive of `after`'s minute boundary) at which `cron` fires,
 * in UTC. Bounded to just over a year so a malformed expression returns null
 * rather than spinning.
 */
export function nextFireAt(cron: string, after: Date): Date | null {
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  const LIMIT_MS = 366 * 24 * 60 * 60_000;
  const deadline = cursor.getTime() + LIMIT_MS;
  while (cursor.getTime() <= deadline) {
    if (cronMatchesMinute(cron, cursor)) return new Date(cursor.getTime());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}
