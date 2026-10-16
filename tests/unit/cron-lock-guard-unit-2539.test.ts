/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCrontabJobs,
  parseVercelJobs,
  parseSchedulerJobs,
  checkLockSites,
  checkScheduledNames,
  checkCrontabDebt,
  collectDivergenceNotes,
  runChecks,
  LOCK_MODULE,
} from '../../scripts/check-cron-lock.mjs';

// #2539 follow-up: the cron-lock guard used to run every rule at import time and
// process.exit(), so none of its 5 rules could be unit-tested. That is how the
// scheduler parser's `[a-z-]` class hid any digit-bearing job name from rule 3
// unnoticed. The rules are now pure and importable; these tests pin each one —
// and the digit-name regression specifically — against injected fixtures, no
// filesystem.

const GOOD_ROUTE_SRC = `import { refuseIfCronLockHeld } from '${LOCK_MODULE}';\nconst r = await refuseIfCronLockHeld('x', 60);\n`;
const reader = (src) => () => src;

describe('parseCrontabJobs', () => {
  it('keeps only run-cron.sh lines, ignores comments and blanks', () => {
    const text = [
      '# nightly',
      '0 4 * * 0   /usr/local/bin/run-cron.sh cleanup',
      '*/15 * * * * /usr/local/bin/run-cron.sh sla-check',
      '',
      '0 * * * * /some/other/cmd.sh not-a-cron',
    ].join('\n');
    expect(parseCrontabJobs(text)).toEqual(['cleanup', 'sla-check']);
  });
});

describe('parseVercelJobs', () => {
  it('strips the /api/cron/ prefix and drops blanks', () => {
    const json = JSON.stringify({
      crons: [
        { path: '/api/cron/trial-check', schedule: '0 * * * *' },
        { path: '/api/cron/lead-warming', schedule: '0 * * * *' },
        { schedule: '0 * * * *' },
      ],
    });
    expect(parseVercelJobs(json)).toEqual(['lead-warming', 'trial-check']);
  });
});

describe('parseSchedulerJobs', () => {
  it('captures hyphenated and DIGIT-bearing names (the #2539 regression)', () => {
    const text = [
      "const JOBS = [",
      "  { name: 'trial-check', path: '/api/cron/trial-check' },",
      "  { name: 'v2-ghost-sweep', path: '/api/cron/v2-ghost-sweep' },",
      "];",
    ].join('\n');
    expect(parseSchedulerJobs(text)).toEqual(['trial-check', 'v2-ghost-sweep']);
  });
});

describe('checkLockSites (rules 1 + 2)', () => {
  it('passes a route that takes its lock through the shared module', () => {
    expect(checkLockSites(['cleanup'], reader(GOOD_ROUTE_SRC))).toEqual([]);
  });
  it('flags a route that re-adds the ok:true skip mask', () => {
    const src = `import { refuseIfCronLockHeld } from '${LOCK_MODULE}';\nreturn NextResponse.json({ ok: true, skipped: true });\n`;
    const problems = checkLockSites(['cleanup'], reader(src));
    expect(problems.some((p) => /reports a skipped run as ok:true/.test(p))).toBe(true);
  });
  it('flags a route that does not import the lock module at all', () => {
    const problems = checkLockSites(['orphan'], reader('export const GET = () => null;'));
    expect(problems.some((p) => /does not take its dedup lock/.test(p))).toBe(true);
  });
});

describe('checkScheduledNames (rule 3)', () => {
  it('names a scheduled job with no route behind it — including a digit name', () => {
    const problems = checkScheduledNames(['cleanup'], {
      crontab: ['cleanup', 'ghost-9'],
      vercel: [],
      inProcess: [],
    });
    expect(problems.some((p) => /schedules "ghost-9"/.test(p))).toBe(true);
  });
});

describe('checkCrontabDebt (rule 4)', () => {
  const tracked = new Set(['backup']);
  it('flags an unscheduled route that is not a tracked decision', () => {
    const problems = checkCrontabDebt(['backup', 'newjob'], ['backup'], tracked);
    expect(problems.some((p) => /newjob has a route but no line/.test(p))).toBe(true);
  });
  it('flags a tracked name that now HAS a line (debt shrank but wasn\'t removed)', () => {
    const problems = checkCrontabDebt(['backup'], ['backup'], tracked);
    expect(problems.some((p) => /backup now HAS a line/.test(p))).toBe(true);
  });
});

describe('collectDivergenceNotes (rule 5)', () => {
  it('reports crontab/vercel divergence as a note, not a problem', () => {
    const notes = collectDivergenceNotes(['cleanup'], {
      crontab: ['cleanup'],
      vercel: ['cleanup', 'vercel-only'],
      inProcess: ['cleanup'],
    });
    expect(notes.some((n) => /vercel-only/.test(n))).toBe(true);
  });
});

describe('runChecks', () => {
  it('is clean for a well-formed tree and reports the right counts', () => {
    const routes = ['cleanup', 'sla-check', 'backup'];
    const { problems, counts } = runChecks({
      routes,
      readRoute: () => GOOD_ROUTE_SRC,
      crontab: ['cleanup', 'sla-check'],
      vercel: ['cleanup', 'sla-check', 'backup'],
      inProcess: routes,
      tracked: new Set(['backup']),
    });
    expect(problems).toEqual([]);
    expect(counts).toEqual({ routes: 3, crontab: 2, vercel: 3, inProcess: 3, unscheduled: 1 });
  });
});
