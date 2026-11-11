/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  renderCrontab,
  renderVercel,
  checkManifest,
  CRONTAB_FILE,
  VERCEL_FILE,
  SCHEDULER_FILE,
} from '../../scripts/gen-cron-manifest.mts';
import { CRON_JOBS, cronMatchesMinute, nextFireAt, scheduledJobs } from '@/lib/cron/jobs';
import { parseCrontabJobs, parseManifestSchedulerJobs } from '../../scripts/check-cron-lock.mjs';

// #3410 PR-2A: one manifest, and three schedule artefacts that CANNOT disagree
// with it. These tests pin the guard's own arithmetic against injected
// fixtures (the check-cron-lock.mjs style #2539 established), plus one test
// that runs the whole rule against the real tree — the repo's checked-in
// state is itself a test assertion now.

const NAMES = CRON_JOBS.map((j) => j.name);
const ROUTES = readdirSync('app/api/cron', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe('the real tree satisfies the manifest guard (#3410)', () => {
  it('is green for the checked-in files', () => {
    const problems = checkManifest({
      jobs: CRON_JOBS,
      routes: ROUTES,
      crontabText: readFileSync(CRONTAB_FILE, 'utf8'),
      vercelText: readFileSync(VERCEL_FILE, 'utf8'),
      schedulerText: readFileSync(SCHEDULER_FILE, 'utf8'),
    });
    expect(problems).toEqual([]);
  });

  it('every route directory is declared and every declared job has a route', () => {
    expect([...NAMES].sort()).toEqual([...ROUTES].sort());
  });
});

describe('deleting or editing an entry in a rendered file goes red (the #3410 proof)', () => {
  const base = {
    jobs: CRON_JOBS,
    routes: ROUTES,
    crontabText: renderCrontab(CRON_JOBS),
    vercelText: renderVercel(CRON_JOBS),
    schedulerText: "import { CRON_JOBS } from '@/lib/cron/jobs';\n",
  };
  const run = (over: Partial<typeof base>) => checkManifest({ ...base, ...over });

  it('a crontab missing any one job is named in the problem list', () => {
    for (const job of CRON_JOBS.filter((j) => j.sources.crontab)) {
      const lines = base.crontabText.split('\n');
      const edited = lines.filter((l) => !l.endsWith(`/run-cron.sh ${job.name}`)).join('\n');
      const problems = run({ crontabText: edited });
      expect(
        problems.some((p) => p.includes(CRONTAB_FILE) && p.includes(job.name)),
        `deleting ${job.name} from the crontab must fail the guard`,
      ).toBe(true);
    }
  });

  it('a crontab schedule edited in place (same names, different cadence) is caught', () => {
    const edited = base.crontabText.replace('*/5 * * * *\t', '*/7 * * * *\t');
    expect(run({ crontabText: edited }).some((p) => p.includes(CRONTAB_FILE))).toBe(true);
  });

  it('a vercel.json job appended by hand is caught', () => {
    const extra = { path: '/api/cron/ghost-job', schedule: '0 0 * * *' };
    const parsed = JSON.parse(base.vercelText);
    parsed.crons.push(extra);
    expect(
      run({ vercelText: `${JSON.stringify(parsed, null, 2)}\n` }).some((p) => p.includes('ghost-job')),
    ).toBe(true);
  });

  it('a scheduler that re-declares literal job entries is caught', () => {
    expect(run({ schedulerText: "const S = [{ name: 'trial-check', path: '/x' }];" }).length).toBeGreaterThan(0);
  });
});

describe('manifest ↔ routes ↔ tracked-debt wiring', () => {
  const base = {
    jobs: CRON_JOBS,
    crontabText: renderCrontab(CRON_JOBS),
    vercelText: renderVercel(CRON_JOBS),
    schedulerText: "import { CRON_JOBS } from '@/lib/cron/jobs';\n",
  };

  it('a route directory with no manifest entry is a problem', () => {
    const problems = checkManifest({ ...base, routes: [...ROUTES, 'untracked-new-job'] });
    expect(problems.some((p) => p.includes('untracked-new-job'))).toBe(true);
  });

  it('an unscheduled job that is not tracked debt is a problem', () => {
    const jobs = CRON_JOBS.map((j) => ({ ...j }));
    jobs[0] = { ...jobs[0]!, sources: { crontab: false, vercel: false, scheduler: false } };
    const problems = checkManifest({ ...base, jobs, routes: ROUTES });
    expect(problems.some((p) => p.includes(NAMES[0]!) && /2539 step-3|tracked/.test(p))).toBe(true);
  });
});

describe('parseManifestSchedulerJobs', () => {
  it('selects exactly the scheduler-fired names from the manifest source', () => {
    const text = readFileSync('lib/cron/jobs.ts', 'utf8');
    expect(parseManifestSchedulerJobs(text)).toEqual(
      CRON_JOBS.filter((j) => j.sources.scheduler).map((j) => j.name).sort(),
    );
  });
});

describe('cron matching (the scheduler’s clock, #3410)', () => {
  const at = (utc: string) => new Date(utc);

  it('matches */5 on the 5-minute grid, including digit-bearing field values', () => {
    expect(cronMatchesMinute('*/5 * * * *', at('2026-11-01T10:15:00Z'))).toBe(true);
    expect(cronMatchesMinute('*/5 * * * *', at('2026-11-01T10:16:00Z'))).toBe(false);
  });

  it('honours hour lists like 0 9,13,17 * * * (warmup-emails)', () => {
    expect(cronMatchesMinute('0 9,13,17 * * *', at('2026-11-01T13:00:00Z'))).toBe(true);
    expect(cronMatchesMinute('0 9,13,17 * * *', at('2026-11-01T12:00:00Z'))).toBe(false);
  });

  it('honours the weekday field (0 0 * * 0 is Sunday)', () => {
    expect(cronMatchesMinute('0 0 * * 0', at('2026-01-04T00:00:00Z'))).toBe(true); // a Sunday
    expect(cronMatchesMinute('0 0 * * 0', at('2026-01-05T00:00:00Z'))).toBe(false);
  });

  it('nextFireAt walks minutes forward and never skips a fire that is due', () => {
    const next = nextFireAt('0 6 * * *', at('2026-11-01T05:59:30Z'));
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    const inside = nextFireAt('0 6 * * *', at('2026-11-01T06:00:30Z'));
    expect(inside!.toISOString()).toBe('2026-11-01T06:00:00.000Z'); // the current minute counts as due
  });

  it('rejects malformed expressions instead of firing on them', () => {
    expect(cronMatchesMinute('*/5 * * *', new Date())).toBe(false);
    expect(nextFireAt('nonsense * * * *', new Date())).toBeNull();
  });
});

describe('the manifest is complete and internally consistent', () => {
  it('every scheduled job declares a sane expectedEveryMs', () => {
    for (const job of scheduledJobs()) {
      expect(job.expectedEveryMs).toBeGreaterThan(0);
      expect(job.maxDurationMs).toBeGreaterThan(0);
      expect(job.owner).not.toBe('');
      expect(job.path).toBe(`/api/cron/${job.name}`);
    }
  });

  it('the rendered crontab parses back to exactly the crontab-flagged names', () => {
    expect(parseCrontabJobs(renderCrontab(CRON_JOBS))).toEqual(
      CRON_JOBS.filter((j) => j.sources.crontab).map((j) => j.name).sort(),
    );
  });
});
