/**
 * #3241 — `guard:vocab` has a runner, and the runner has a screen of its own.
 *
 * PP-059 recorded that the only command in this repo which asks a REAL database what its CHECK
 * constraints will reject was invoked by no automation: a green CI proved only that the `.sql` text
 * says the right thing. The fix is a `constraint-vocab` job in `ci.yml`. A job added to a workflow is
 * invisible to every other screen in this repository — `guard:coords` reads coordinates, the register
 * reads prose — so this file pins the four properties that make the job worth having:
 *
 *   1. it measures a database the MIGRATION CHAIN produced. `db:sync`'s pushed schema would make the
 *      comparison tautological, and the file-level `env:` `DATABASE_URL` at `ci.yml:11` names
 *      `nucrm_test`, which this job provisions nowhere: the guard would exit 2 — "could not run", not
 *      "clean" — and the run would be red for the wrong reason;
 *   2. it runs BOTH controls. A positive exit-0 alone is the reasoning #2306 retracted for the role
 *      guards: an assertion that a green screen means something. The negative control narrows
 *      `chk_invoices_status` and requires the guard to go red naming `invoices.status` and `'void'`;
 *   3. the control breaks the constraint the registry actually reads, so it cannot pass by accident,
 *      and removes exactly one required value rather than the whole vocabulary;
 *   4. it is APPENDED. The register cites `ci.yml` coordinates up to `:447`, and `guard:coords` reads
 *      them, so a job inserted anywhere above the end of the file moves all of them.
 *
 * Ported from the test that accompanied PR #3245 (same issue, parallel branch), adapted to this job's
 * shape: `POSTGRES_DB` names the chain database so no step has to CREATE it, the guard steps inherit
 * one job-level `DATABASE_URL` rather than re-exporting it per step, and the negative control asserts
 * the failure is `missing-in-db` and exit 1 specifically.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CI_FILE = '.github/workflows/ci.yml';
const ci = readFileSync(resolve(ROOT, CI_FILE), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const registry = JSON.parse(readFileSync(resolve(ROOT, 'scripts/constraint-vocab.json'), 'utf8')) as {
  constraints: {
    id: string;
    constraint: string;
    table: string;
    column: string;
    required: string[];
    legacy: string[];
  }[];
};

const JOB_KEY = '\n  constraint-vocab:';
const jobStart = ci.indexOf(JOB_KEY);
/** Everything from the job key to end-of-file: the job is last, so this slice is the job. */
const job = jobStart === -1 ? '' : ci.slice(jobStart);

/** The `run:` body of the step whose name contains `nameFragment`. */
function stepBody(nameFragment: string): string {
  const at = job.indexOf(nameFragment);
  if (at === -1) return '';
  const next = job.slice(at + nameFragment.length).search(/\n {6}- /);
  return next === -1 ? job.slice(at) : job.slice(at, at + nameFragment.length + next);
}

/** Every shell line the job actually executes — comments excluded, since they may name what the code must not do. */
function runLines(): string[] {
  return [...job.matchAll(/^ {6}- (?:run: |name: [^\n]*\n {8}run: \|\n)((?: {10}.+\n?)+)/gm)]
    .flatMap((m) => m[1].split('\n'));
}

const positive = stepBody('name: Positive control');
const negative = stepBody('name: Negative control');

describe('#3241 the constraint-vocab job exists and is appended', () => {
  it('is declared, with a human-readable job name and a timeout', () => {
    expect(jobStart, `${CI_FILE} must declare a constraint-vocab job (#3241)`).toBeGreaterThan(-1);
    expect(job).toContain('name: Constraint vocabulary vs migration chain (PP-059)');
    expect(job).toContain('timeout-minutes:');
  });

  it('is the LAST job in the file, so no register coordinate above it moved', () => {
    const jobKeys = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    expect(jobKeys.at(-1)).toBe('constraint-vocab');
    // The coordinates the register names — `ci.yml:221`, `:254`, `:401-409`, `:447` — have to stay
    // above the insertion point, which is what `npm run guard:coords` reads.
    const jobLine = ci.slice(0, jobStart).split('\n').length;
    expect(jobLine).toBeGreaterThan(447);
  });

  it('runs the guard as the package.json alias, not a hand-copied command', () => {
    expect(pkg.scripts['guard:vocab']).toContain('scripts/check-constraint-vocab.mts');
    expect(positive).toContain('npm run guard:vocab');
    expect(negative).toContain('npm run guard:vocab');
  });
});

describe('#3241 it measures the database the migration chain produced', () => {
  it('provisions the very database its DATABASE_URL names, and it is not nucrm_test', () => {
    expect(job).toContain('image: postgres:16-alpine');
    const serviceDb = job.match(/POSTGRES_DB:\s*(\S+)/)?.[1];
    const urlDb = job.match(/DATABASE_URL:\s*postgresql:\/\/[^/\s]+\/(\S+)/)?.[1];
    expect(serviceDb, 'the service must create a database').toBeDefined();
    expect(urlDb, 'the job must override the file-level DATABASE_URL').toBeDefined();
    expect(urlDb).toBe(serviceDb);
    expect(serviceDb).not.toBe('nucrm_test');
    expect(job).toMatch(/DATABASE_SSL:\s*"?false"?/);
  });

  it('bootstraps the chain and never pushes a schema', () => {
    expect(stepBody('name: Build the schema')).toContain('npm run db:bootstrap -- --yes');
    // Comments may name `db:sync` to explain why it is not used; an executed line may not.
    expect(runLines().filter((l) => l.includes('db:sync'))).toEqual([]);
  });
});

describe('#3241 the positive control reports what it measured', () => {
  it('fails the job on a nonzero guard exit rather than swallowing it', () => {
    expect(positive).toContain('set -uo pipefail');
    // tee alone would replace the guard's exit code with tee's.
    expect(positive).toContain('npm run guard:vocab 2>&1 | tee');
    expect(positive).toContain('code=${PIPESTATUS[0]}');
    expect(positive).toContain('exit "$code"');
  });

  it('tells the reader what to do about a red control', () => {
    expect(positive).toContain('23514');
    expect(positive).toContain('Do not delete the registry entry to silence this job');
  });
});

describe('#3241 the negative control proves the screen fires', () => {
  it('drops and re-adds the very constraint the registry reads', () => {
    const entry = registry.constraints.find((c) => c.id === 'invoices.status');
    expect(entry, 'scripts/constraint-vocab.json must still carry invoices.status').toBeDefined();
    expect(negative).toContain(`ALTER TABLE "${entry!.table}" DROP CONSTRAINT`);
    expect(negative).toContain(entry!.constraint);
    expect(negative).toContain(entry!.column);
  });

  it('re-adds the registry list minus exactly one required value', () => {
    const entry = registry.constraints.find((c) => c.id === 'invoices.status')!;
    const add = negative.slice(negative.search(/ADD CONSTRAINT/));
    const literals = [...add.slice(0, add.search(/SQL\s*\n/)).matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(literals.length, 'the control must write its vocabulary inline, not echo the DB one').toBeGreaterThan(0);
    const removed = entry.required.filter((v) => !literals.includes(v));
    expect(removed, 'the control has to remove a value the code writes').toHaveLength(1);
    expect(removed[0]).toBe('void');
    for (const keep of entry.required) if (keep !== removed[0]) expect(literals).toContain(keep);
  });

  it('requires a FAILURE from the guard, then requires the right reason', () => {
    // Passing is the bug: the step must treat exit 0 as the finding.
    expect(negative).toContain('npm run guard:vocab -- --json');
    expect(negative).toContain('|| code=$?');
    expect(negative).toContain('[ "$code" != "1" ]');
    expect(negative).toContain('exit 1');
    expect(negative).toContain('"id": *"invoices.status"');
    expect(negative).toContain('"kind": *"missing-in-db"');
    expect(negative).toContain("'void'");
    expect(negative).toContain('guard-vocab-negative.log');
  });

  it('captures the expected red instead of letting errexit abort the assertions', () => {
    // Run 40206649243 proved the failure mode first-hand: `bash -e {0}` is the default shell for a
    // `run:` step, `set -uo pipefail` does not clear `-e`, and a bare expected-red guard call aborts
    // the step before a single grep or annotation runs.
    expect(negative).toContain('bash -e');
  });
});
