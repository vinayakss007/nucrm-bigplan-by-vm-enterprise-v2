/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Cron lock + schedule guard (#2539, register PP-049).
 *
 * Two defects this stops from coming back:
 *
 *  1. All 22 cron routes answered a REFUSED dedup lock with
 *     `200 { ok: true, skipped: true }`. The block was copy-pasted per route, so
 *     a skipped run was indistinguishable from a successful one — in the panel,
 *     to the scheduler, and in the logs. They now answer `423 { ok: false }`
 *     from one place, `lib/cron/cron-lock.ts`. A route that re-adds its own
 *     mask, or that reaches for `acquireLock` directly again, fails here.
 *
 *  2. Routes and schedules disagreed: 22 routes, 17 crontab lines. A route that
 *     is never scheduled is a feature wearing a scheduler costume
 *     (`recurring-invoice-generator` — billing). A schedule line naming a route
 *     that does not exist is a job that silently never runs at all.
 *
 * Measured at main = 2d037d6a the three schedule sources are three different
 * sets, so rule 3 checks each of them separately rather than assuming one
 * table: deploy/cron/crontab (17 jobs, the pm2/VM production scheduler),
 * vercel.json crons (18, Vercel only) and scripts/cron-scheduler.ts (18, the
 * in-process alternative). #1422 says exactly ONE is active per environment, so
 * they are not required to be identical — but every divergence must be a named,
 * tracked decision, and a tracked set may only shrink.
 *
 * The pure rules are exported and the filesystem/CLI layer sits behind an
 * import.meta.url guard, so each rule is unit-testable with injected fixtures
 * the way scripts/check-register-coords.mjs already is. #2539's own verification
 * found that when this file ran everything at import and exited, the scheduler
 * parser's `[a-z-]` class silently hid any digit-bearing job name from rule 3 —
 * untestable, therefore invisible. It is `[a-z0-9-]` now and covered by a test.
 *
 * Usage (from the repo root): node scripts/check-cron-lock.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CRON_DIR = 'app/api/cron';
export const CRONTAB_FILE = 'deploy/cron/crontab';
export const VERCEL_FILE = 'vercel.json';
export const SCHEDULER_FILE = 'scripts/cron-scheduler.ts';
export const LOCK_MODULE = '@/lib/cron/cron-lock';

/**
 * Routes with no line in the production crontab. This is #2539 step 3, and it
 * is an OWNER DECISION, not engineering work I may make unilaterally: each name
 * is either given a schedule or deleted. They stay listed here so the guard is
 * green while the decision is open — and so the list can only shrink. Adding a
 * crontab line without removing the name below fails the guard, which is what
 * stops this set from quietly becoming a catch-all.
 */
export const UNSCHEDULED_IN_CRONTAB = new Set([
  'backup',
  'lead-warming',
  'process-lead-scoring',
  'recurring-invoice-generator',
  'sla-check',
]);

// ── Pure parsers: text in, job-name list out (no filesystem touched) ────────

/** `0 4 * * 0   /usr/local/bin/run-cron.sh cleanup` -> cleanup */
export function parseCrontabJobs(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^[^\s#]+\s+[^\s#]+\s+[^\s#]+\s+[^\s#]+\s+[^\s#]+\s+\/usr\/local\/bin\/run-cron\.sh\s/.test(line))
    .map((line) => line.trim().split(/\s+/).pop())
    .sort();
}

/** vercel.json `crons[].path` -> the job name it fires. */
export function parseVercelJobs(jsonText) {
  const crons = JSON.parse(jsonText).crons ?? [];
  return crons
    .map((entry) => String(entry?.path ?? '').replace(/^\/api\/cron\//, ''))
    .filter(Boolean)
    .sort();
}

/** `scripts/cron-scheduler.ts` JOBS entries: `{ name: 'trial-check', path: … }` */
export function parseSchedulerJobs(text) {
  // The class must stay [a-z0-9-]: a name dropped here is invisible to rule 3,
  // which is the "green while not looking" failure this guard exists to stop.
  const names = [...text.matchAll(/\{\s*name:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

// ── Pure rules: job lists + a per-route source reader in, problems out ──────

/** Rules 1 + 2 — one lock site per route, and no local `ok:true` skip mask. */
export function checkLockSites(routes, readRoute) {
  const problems = [];
  for (const dir of routes) {
    const file = join(CRON_DIR, dir, 'route.ts');
    const src = readRoute(dir);
    if (!src.includes(`from '${LOCK_MODULE}'`)) {
      problems.push(`${file} does not take its dedup lock through ${LOCK_MODULE} (#2539).`);
    }
    if (!/refuseIfCronLockHeld\(|cronLockRefusalResponse\(/.test(src)) {
      problems.push(`${file} acquires a cron lock without answering it: neither refuseIfCronLockHeld() nor cronLockRefusalResponse() is called.`);
    }
    if (/ok:\s*true\s*,\s*skipped\s*:/.test(src)) {
      problems.push(`${file} reports a skipped run as ok:true — the exact mask #2539 removed. A refusal is 423 / { ok: false, skipped: "lock-held" } from lib/cron/cron-lock.ts.`);
    }
  }
  return problems;
}

/** Rule 3 — every scheduled name across all three sources must have a route. */
export function checkScheduledNames(routes, { crontab, vercel, inProcess }) {
  const problems = [];
  const routeSet = new Set(routes);
  for (const [source, jobs] of [
    [CRONTAB_FILE, crontab],
    [VERCEL_FILE, vercel],
    [SCHEDULER_FILE, inProcess],
  ]) {
    for (const job of jobs) {
      if (!routeSet.has(job)) {
        problems.push(`${source} schedules "${job}", but ${join(CRON_DIR, job, 'route.ts')} does not exist — that job fires and goes nowhere.`);
      }
    }
  }
  return problems;
}

/** Rule 4 — production parity; the tracked-debt set may only shrink. */
export function checkCrontabDebt(routes, crontab, tracked = UNSCHEDULED_IN_CRONTAB) {
  const problems = [];
  const unscheduled = routes.filter((name) => !crontab.includes(name));
  for (const name of [...tracked].filter((n) => !unscheduled.includes(n))) {
    problems.push(
      `${name} now HAS a line in ${CRONTAB_FILE}. Remove it from UNSCHEDULED_IN_CRONTAB in this guard: ` +
        `that set is tracked debt awaiting an owner decision (#2539 step 3), not a standing permit.`,
    );
  }
  for (const name of unscheduled.filter((n) => !tracked.has(n))) {
    problems.push(
      `${name} has a route but no line in ${CRONTAB_FILE} and no tracked decision. Either schedule it in the ` +
        `same PR or record it in #2539 step 3 for the owner to settle — do not add it to the guard silently.`,
    );
  }
  return problems;
}

/** Rule 5 — the alternative schedulers may differ, but say so as notes. */
export function collectDivergenceNotes(routes, { crontab, vercel, inProcess }) {
  const notes = [];
  const diff = (a, b) => a.filter((name) => !b.includes(name));
  const crontabOnly = diff(crontab, vercel);
  const vercelOnly = diff(vercel, crontab);
  if (crontabOnly.length || vercelOnly.length) {
    notes.push(
      `${CRONTAB_FILE} and ${VERCEL_FILE} differ (crontab-only: ${crontabOnly.join(', ') || '—'}; ` +
        `vercel-only: ${vercelOnly.join(', ') || '—'}). #1422 allows this because only one is active per ` +
        `environment, but a Vercel deploy does not run the same jobs as the VM.`,
    );
  }
  const missingFromInProcess = diff(routes, inProcess);
  if (missingFromInProcess.length) {
    notes.push(
      `${SCHEDULER_FILE} does not fire: ${missingFromInProcess.join(', ')} — an in-process deployment would ` +
        `skip these jobs even though the routes exist.`,
    );
  }
  return notes;
}

/**
 * Run every rule against supplied job lists and a per-route source reader.
 * Returns the problems/notes arrays plus the counts the summary line prints.
 */
export function runChecks({ routes, readRoute, crontab, vercel, inProcess, tracked = UNSCHEDULED_IN_CRONTAB }) {
  const problems = [
    ...checkLockSites(routes, readRoute),
    ...checkScheduledNames(routes, { crontab, vercel, inProcess }),
    ...checkCrontabDebt(routes, crontab, tracked),
  ];
  const notes = collectDivergenceNotes(routes, { crontab, vercel, inProcess });
  const unscheduled = routes.filter((name) => !crontab.includes(name));
  return {
    problems,
    notes,
    counts: {
      routes: routes.length,
      crontab: crontab.length,
      vercel: vercel.length,
      inProcess: inProcess.length,
      unscheduled: unscheduled.length,
    },
  };
}

// ── CLI: read the real tree, run the rules, print, exit ─────────────────────
export function main() {
  const read = (file) => readFileSync(file, 'utf8');
  const routes = readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try { readFileSync(join(CRON_DIR, entry.name, 'route.ts')); return true; } catch { return false; }
    })
    .map((entry) => entry.name)
    .sort();

  const { problems, notes, counts } = runChecks({
    routes,
    readRoute: (dir) => read(join(CRON_DIR, dir, 'route.ts')),
    crontab: parseCrontabJobs(read(CRONTAB_FILE)),
    vercel: parseVercelJobs(read(VERCEL_FILE)),
    inProcess: parseSchedulerJobs(read(SCHEDULER_FILE)),
  });

  if (problems.length > 0) {
    console.error(
      `\n[check-cron-lock] FAIL — ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n\n` +
        problems.map((p) => `    - ${p}`).join('\n\n') +
        '\n',
    );
    process.exit(1);
  }

  for (const note of notes) console.warn(`[check-cron-lock] NOTE: ${note}`);
  console.log(
    `[check-cron-lock] OK — ${counts.routes} cron routes all refuse a held lock with 423 via ${LOCK_MODULE}; ` +
      `${counts.crontab} crontab jobs, ${counts.vercel} vercel.json crons and ${counts.inProcess} in-process jobs ` +
      `all point at real routes; ${counts.unscheduled} unscheduled routes tracked for the #2539 step 3 decision.`,
  );
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
