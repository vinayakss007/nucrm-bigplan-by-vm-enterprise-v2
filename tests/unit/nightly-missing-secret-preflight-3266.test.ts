/**
 * #3266 — a missing PREPROD_DATABASE_URL is a configuration error, not a code
 * regression.
 *
 * Two scheduled jobs used to discover the missing secret only after checkout,
 * `npm ci` and (in the RLS job) two control steps: the run went red at "Live
 * guards against the pre-prod database" / "Drift check against the pre-prod
 * database", which reads like the guard found a problem in the code. The issue
 * asks for `::error::PREPROD_DATABASE_URL is not configured` before anything
 * runs, so the red X names the missing secret.
 *
 * These tests pin the shape that makes that true:
 *   1. `Require PREPROD_DATABASE_URL` is step 0 of each live job, before
 *      `actions/checkout` and `npm ci`;
 *   2. it reads the repository secret, and an empty value exits 1 with the
 *      required `::error::` line;
 *   3. the old in-step duplicate is gone, so there is exactly one place that
 *      decides the job cannot run; and
 *   4. the existing `if: failure()` alert step survives, so the preflight
 *      failure still reaches operations.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const NIGHTLY_FILE = '.github/workflows/nightly-soak.yml';
const DRIFT_FILE = '.github/workflows/schema-drift.yml';
const NIGHTLY = readFileSync(resolve(ROOT, NIGHTLY_FILE), 'utf8');
const DRIFT = readFileSync(resolve(ROOT, DRIFT_FILE), 'utf8');

const REQUIRED_ERROR = '::error::PREPROD_DATABASE_URL is not configured';

interface Step {
  name: string;
  uses: string;
  run: string;
  env: string;
  raw: string;
}

/** The lines of one top-level job, from its key to the next top-level job. */
function jobSlice(workflow: string, job: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) throw new Error(`${job} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Every `- ` entry under the job's `steps:` key, dedented to column 0. */
function stepsOf(job: string): Step[] {
  const lines = job.split('\n');
  const start = lines.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  if (start === -1) throw new Error('job has no steps');
  const blocks: string[][] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {6}- /.test(line)) {
      blocks.push([line]);
      continue;
    }
    if (blocks.length === 0) continue;
    if (line.trim() === '') {
      blocks.at(-1)!.push('');
      continue;
    }
    if (/^ {0,5}\S/.test(line)) break; // dedented out of `steps:`
    blocks.at(-1)!.push(line);
  }
  return blocks.map((block) => {
    const raw = block
      .map((line) => (line.startsWith('        ') ? line.slice(8) : line.replace(/^ {6}- /, '')))
      .join('\n');
    return {
      raw,
      name: (raw.match(/^name:\s*(.+)$/m)?.[1] ?? '').trim(),
      uses: (raw.match(/^uses:\s*(.+)$/m)?.[1] ?? '').trim(),
      run: runBody(raw),
      env: (raw.match(/^env:\n((?: {2}\S.*\n?)+)/m)?.[1] ?? '').trim(),
    };
  });
}

/** The body of a `run:` step, block scalar or inline. */
function runBody(raw: string): string {
  const lines = raw.split('\n');
  const at = lines.findIndex((line) => /^run:\s*\|/.test(line));
  if (at === -1) return (raw.match(/^run:\s*(\S.*)$/m)?.[1] ?? '').trim();
  const body: string[] = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '' && !/^ {2,}/.test(lines[i])) break;
    body.push(lines[i].replace(/^ {2}/, ''));
  }
  return body.join('\n');
}

const nightlyGuards = stepsOf(jobSlice(NIGHTLY, 'rls-guards'));
const driftLive = stepsOf(jobSlice(DRIFT, 'live'));
const driftSynthetic = stepsOf(jobSlice(DRIFT, 'synthetic'));

const preflight = (steps: Step[]) => steps.find((step) => step.name === 'Require PREPROD_DATABASE_URL');

function executePreflight(script: string, value?: string) {
  const env = { ...process.env };
  delete env.PREPROD_DATABASE_URL;
  if (value !== undefined) env.PREPROD_DATABASE_URL = value;
  return spawnSync('bash', ['-c', script], { cwd: ROOT, encoding: 'utf8', env });
}

describe.each([
  ['nightly-soak.yml rls-guards', NIGHTLY_FILE, nightlyGuards],
  ['schema-drift.yml live', DRIFT_FILE, driftLive],
])('#3266 %s fails before it does any work', (_label, file, steps) => {
  it('declares the preflight as step 0, before checkout and npm ci', () => {
    expect(steps[0]?.name, `${file} must start with the secret preflight`).toBe(
      'Require PREPROD_DATABASE_URL',
    );
    const checkout = steps.findIndex((step) => step.uses.startsWith('actions/checkout@'));
    const npmCi = steps.findIndex((step) => step.run.includes('npm ci'));
    expect(checkout).toBeGreaterThan(0);
    expect(npmCi).toBeGreaterThan(0);
  });

  it('reads the repository secret rather than a hard-coded URL', () => {
    const step = preflight(steps);
    expect(step, `${file} must declare the preflight`).toBeDefined();
    expect(step!.env).toContain('PREPROD_DATABASE_URL: ${{ secrets.PREPROD_DATABASE_URL }}');
    expect(step!.run).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('fails with the exact ::error:: line when the secret is empty', () => {
    const script = preflight(steps)!.run;
    const result = executePreflight(script);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(REQUIRED_ERROR);
  });

  it('passes without touching the database when the secret is present', () => {
    const script = preflight(steps)!.run;
    const result = executePreflight(script, 'postgresql://guard:redacted@db.example:5432/nucrm');
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(REQUIRED_ERROR);
  });

  it('is the only place that refuses the missing secret', () => {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    const occurrences = source.split(REQUIRED_ERROR).length - 1;
    expect(occurrences).toBe(1);
  });

  it('keeps the failure alert wired to the preflight failure', () => {
    const alert = steps.find((step) => step.name === 'Alert operations on failure');
    expect(alert, `${file} must keep the operations alert`).toBeDefined();
    expect(alert!.raw).toContain('if: failure()');
    expect(alert!.env).toContain('CRITICAL_ALERT_URL: ${{ secrets.CRITICAL_ERROR_WEBHOOK_URL }}');
  });
});

describe('#3266 the preflight does not spread to jobs that do not need the secret', () => {
  it('the schema-drift synthetic job keeps its own throwaway database', () => {
    expect(preflight(driftSynthetic)).toBeUndefined();
    expect(driftSynthetic.some((step) => step.run.includes('db:bootstrap'))).toBe(true);
  });

  it('the old in-step empty check is gone from both live steps', () => {
    const nightlyLive = nightlyGuards.find((step) => step.name === 'Live guards against the pre-prod database');
    const driftLiveStep = driftLive.find((step) => step.name === 'Drift check against the pre-prod database');
    expect(nightlyLive?.run).not.toContain('if [ -z "${DATABASE_URL:-}" ]');
    expect(driftLiveStep?.run).not.toContain('if [ -z "${DATABASE_URL:-}" ]');
  });
});
