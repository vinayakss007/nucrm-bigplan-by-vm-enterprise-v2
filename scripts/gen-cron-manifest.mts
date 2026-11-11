/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Cron manifest generator + guard (#3410 PR-2A).
 *
 * `lib/cron/jobs.ts` declares every scheduled job once. This script renders
 * the two declarative schedule files from that manifest —
 * `deploy/cron/crontab` and the `crons` array of `vercel.json` — and either
 * WRITES them (`npm run cron:manifest`) or CHECKs them (`npm run
 * guard:cron-manifest`, wired into PR CI). A schedule edited directly in one
 * of those files, a job added to the manifest without a route, or a new
 * unscheduled orphan slipped in outside the tracked-debt set all make the
 * guard red: divergence becomes a build failure, not a NOTE comment.
 *
 * The in-process scheduler (`scripts/cron-scheduler.ts`) is not rendered —
 * it imports the manifest directly, so it cannot drift by construction. The
 * guard still asserts it derives its jobs from `@/lib/cron/jobs` instead of
 * re-declaring a JOBS array (the shape #3410 removed).
 *
 * Usage:
 *   npx tsx scripts/gen-cron-manifest.mts          # write the files
 *   npx tsx scripts/gen-cron-manifest.mts --check  # verify, exit 1 on drift
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRON_JOBS, type CronJobSpec } from '../lib/cron/jobs';
import { UNSCHEDULED_IN_CRONTAB, parseCrontabJobs, parseVercelJobs } from './check-cron-lock.mjs';

export const CRON_DIR = 'app/api/cron';
export const CRONTAB_FILE = 'deploy/cron/crontab';
export const VERCEL_FILE = 'vercel.json';
export const SCHEDULER_FILE = 'scripts/cron-scheduler.ts';

/**
 * Header kept in deploy/cron/crontab. #1422: exactly one scheduler per
 * environment — this text is part of the generated output so it can never
 * describe a schedule the manifest does not have.
 */
export const CRONTAB_HEADER = `# NuCRM — Cron Schedule — GENERATED FILE (#3410).
#
# Do not edit: every line here is rendered from lib/cron/jobs.ts
# (npm run cron:manifest). PR CI runs npm run guard:cron-manifest, and an
# edit this file alone fails the build. vercel.json crons is generated the
# same way.
#
# SCHEDULER POLICY (#1422): exactly ONE scheduler is active per environment.
# pm2/VM deployments (production) use THIS host crontab. vercel.json crons
# are only active on Vercel-hosted deployments; scripts/cron-scheduler.ts
# (pm2 \`cron\` / the in-process alternative) reads the same manifest.
# Never enable two against the same environment — routes carry Redis dedup
# locks as a safety net, but do not rely on them.
#
# All jobs call the app's API endpoints with CRON_SECRET auth.
# A crontab line must be re-installed on the host with every deploy
# (crontab deploy/cron/crontab — verify with crontab -l afterwards).
`;

/** Manifest -> crontab body text, jobs with sources.crontab in manifest order. */
export function renderCrontab(jobs: readonly CronJobSpec[]): string {
  const lines = jobs
    .filter((job) => job.sources.crontab)
    .map((job) => `${job.cron}\t/usr/local/bin/run-cron.sh ${job.name}`);
  return `${CRONTAB_HEADER}\n${lines.join('\n')}\n`;
}

/** Manifest -> vercel.json, preserving the file's single `crons` key shape. */
export function renderVercel(jobs: readonly CronJobSpec[]): string {
  const crons = jobs
    .filter((job) => job.sources.vercel)
    .map((job) => ({ path: job.path, schedule: job.cron }));
  return `${JSON.stringify({ crons }, null, 2)}\n`;
}

/**
 * Pure rule: the three checkable invariants of the manifest world.
 *  1. every route directory is declared and every declared name has a route;
 *  2. the checked-in crontab and vercel.json equal what the manifest renders;
 *  3. a job with no scheduler firing it is tracked as #2539 step-3 debt.
 * Also rejects a scheduler that re-declares its own JOBS array (#3410's shape).
 */
export function checkManifest({
  jobs,
  routes,
  crontabText,
  vercelText,
  schedulerText,
  tracked = UNSCHEDULED_IN_CRONTAB,
  skipRenderEquality = false,
}: {
  jobs: readonly CronJobSpec[];
  routes: string[];
  crontabText: string;
  vercelText: string;
  schedulerText: string;
  tracked?: Set<string>;
  skipRenderEquality?: boolean;
}): string[] {
  const problems: string[] = [];
  const names = jobs.map((j) => j.name);
  const nameSet = new Set(names);
  if (names.length !== nameSet.size) problems.push('lib/cron/jobs.ts declares the same job name twice.');

  for (const route of routes) {
    if (!nameSet.has(route)) {
      problems.push(`${join(CRON_DIR, route, 'route.ts')} exists but no manifest entry in lib/cron/jobs.ts — add it there, not to the schedule files.`);
    }
  }
  for (const job of jobs) {
    if (!routes.includes(job.name)) {
      problems.push(`lib/cron/jobs.ts declares "${job.name}", but ${join(CRON_DIR, job.name, 'route.ts')} does not exist — that job fires and goes nowhere.`);
    }
    if (job.path !== `/api/cron/${job.name}`) {
      problems.push(`lib/cron/jobs.ts entry "${job.name}" has path ${JSON.stringify(job.path)}; the manifest convention is /${join(CRON_DIR, job.name)}.`);
    }
  }

  const expectedCrontab = renderCrontab(jobs);
  if (!skipRenderEquality && crontabText !== expectedCrontab) {
    const expected = parseCrontabJobs(expectedCrontab) as string[];
    const actual = parseCrontabJobs(crontabText) as string[];
    const missing = expected.filter((n) => !actual.includes(n));
    const extra = actual.filter((n) => !expected.includes(n));
    if (missing.length || extra.length) {
      problems.push(
        `${CRONTAB_FILE} does not match lib/cron/jobs.ts (manifest-only: ${missing.join(', ') || '—'}; file-only: ${extra.join(', ') || '—'}). ` +
          'A schedule change is a manifest edit plus `npm run cron:manifest`.',
      );
    } else {
      problems.push(`${CRONTAB_FILE} lists the manifest's jobs but its text is no longer the generated rendering — run \`npm run cron:manifest\`.`);
    }
  }

  const expectedVercel = renderVercel(jobs);
  if (!skipRenderEquality && vercelText !== expectedVercel) {
    const expected = parseVercelJobs(expectedVercel) as string[];
    const actual = parseVercelJobs(vercelText) as string[];
    const missing = expected.filter((n) => !actual.includes(n));
    const extra = actual.filter((n) => !expected.includes(n));
    if (missing.length || extra.length) {
      problems.push(
        `${VERCEL_FILE} crons do not match lib/cron/jobs.ts (manifest-only: ${missing.join(', ') || '—'}; file-only: ${extra.join(', ') || '—'}). ` +
          'A schedule change is a manifest edit plus `npm run cron:manifest`.',
      );
    } else {
      problems.push(`${VERCEL_FILE} matches the manifest's jobs but is no longer the generated rendering — run \`npm run cron:manifest\`.`);
    }
  }

  if (!/from ['"](@|\.\.)\/lib\/cron\/jobs['"]/.test(schedulerText)) {
    problems.push(`${SCHEDULER_FILE} must fire the manifest (import from lib/cron/jobs.ts); a re-declared job list is the #3410 drift this guard exists to stop.`);
  }
  if (/\{\s*name:\s*'/.test(schedulerText)) {
    problems.push(`${SCHEDULER_FILE} re-declares job entries as object literals — derive them from lib/cron/jobs.ts (#3410).`);
  }

  for (const job of jobs) {
    const unscheduled = !job.sources.crontab && !job.sources.vercel && !job.sources.scheduler;
    if (!job.sources.crontab && !tracked.has(job.name)) {
      problems.push(
        `lib/cron/jobs.ts says "${job.name}" does not run in ${CRONTAB_FILE}, but it is not in UNSCHEDULED_IN_CRONTAB in scripts/check-cron-lock.mjs — ` +
          'a crontab omission is a tracked #2539 step-3 decision, not silence.',
      );
    }
    if (unscheduled && !tracked.has(job.name)) {
      problems.push(`lib/cron/jobs.ts declares "${job.name}" with no scheduler firing it — schedule it, delete the route, or track it as #2539 step-3 debt.`);
    }
  }
  for (const trackedName of tracked) {
    if (!nameSet.has(trackedName)) {
      problems.push(`UNSCHEDULED_IN_CRONTAB still names "${trackedName}", which has no manifest entry — the debt set must shrink with the routes.`);
    }
  }

  return problems;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
export function main(argv: string[]) {
  const check = argv.includes('--check');
  const routes = readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try { readFileSync(join(CRON_DIR, entry.name, 'route.ts'), 'utf8'); return true; } catch { return false; }
    })
    .map((entry) => entry.name)
    .sort();

  const crontabText = readFileSync(CRONTAB_FILE, 'utf8');
  const vercelText = readFileSync(VERCEL_FILE, 'utf8');
  const schedulerText = readFileSync(SCHEDULER_FILE, 'utf8');

  const problems = checkManifest({ jobs: CRON_JOBS, routes, crontabText, vercelText, schedulerText, skipRenderEquality: !check });
  if (problems.length > 0) {
    console.error(
      `\n[gen-cron-manifest] FAIL — ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n\n` +
        problems.map((p) => `    - ${p}`).join('\n\n') + '\n',
    );
    process.exit(1);
  }

  const fired = CRON_JOBS.filter((j) => j.sources.crontab || j.sources.vercel || j.sources.scheduler).length;
  const orphans = CRON_JOBS.length - fired;
  if (check) {
    console.log(
      `[gen-cron-manifest] OK — ${CRON_JOBS.length} manifest jobs (${fired} scheduled, ${orphans} tracked orphans); ` +
        `${CRONTAB_FILE} and ${VERCEL_FILE} match the generated rendering; ${SCHEDULER_FILE} fires the manifest.`,
    );
    return;
  }
  writeFileSync(CRONTAB_FILE, renderCrontab(CRON_JOBS));
  writeFileSync(VERCEL_FILE, renderVercel(CRON_JOBS));
  console.log(`[gen-cron-manifest] wrote ${CRONTAB_FILE} and ${VERCEL_FILE} from lib/cron/jobs.ts (${CRON_JOBS.length} jobs).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
