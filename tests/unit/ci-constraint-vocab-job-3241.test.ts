/**
 * #3241 — `guard:vocab` has a runner, and the runner has teeth.
 *
 * PP-059 recorded that the only command in this repo which asks a REAL database
 * what its CHECK constraints will reject was invoked by no automation: a green CI
 * proved only that the `.sql` text says the right thing. The fix is a
 * `constraint-vocab` job in `ci.yml`. A job added to a workflow is invisible to
 * every other screen in this repository, so this one pins what makes it worth
 * having:
 *
 *   1. it measures a database the MIGRATION CHAIN produced — not `db:sync`'s
 *      pushed schema, which would make the comparison tautological, and not the
 *      file-level `env:` `DATABASE_URL` at `ci.yml:11`, which names `nucrm_test`
 *      and exists in no service of this job (the guard would exit 2 and the run
 *      would be red for the wrong reason);
 *   2. it runs BOTH controls, per the rule `schema-drift.yml:17-24` adopted — a
 *      positive exit-0, and a deliberately narrowed `chk_invoices_status` that
 *      MUST turn the screen red naming `invoices.status` and `'void'`. Without
 *      (2) the job is an assertion that a green screen means something, which is
 *      the reasoning #2306 retracted for the role guards;
 *   3. the negative control breaks the constraint the registry actually reads, so
 *      it cannot pass by accident; and
 *   4. it is APPENDED. The register cites `ci.yml` coordinates up to `:447`, and
 *      `:447` is one of them — a job inserted anywhere above the end of the file
 *      moves all of them out from under `npm run guard:coords`.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CI_FILE = '.github/workflows/ci.yml';
const ci = readFileSync(resolve(ROOT, CI_FILE), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const registry = JSON.parse(readFileSync(resolve(ROOT, 'scripts/constraint-vocab.json'), 'utf8')) as {
  constraints: { id: string; constraint: string; table: string; column: string; required: string[]; legacy: string[] }[];
};

const JOB_KEY = '\n  constraint-vocab:';
const jobStart = ci.indexOf(JOB_KEY);
/** Everything from the job key to end-of-file: the job is last, so this is the job. */
const job = jobStart === -1 ? '' : ci.slice(jobStart);

/** The `run:` body of the step whose name contains `nameFragment`. */
function stepBody(nameFragment: string): string {
  const at = job.indexOf(nameFragment);
  if (at === -1) return '';
  const next = job.slice(at + nameFragment.length).search(/\n {6}- /);
  return next === -1 ? job.slice(at) : job.slice(at, at + nameFragment.length + next);
}

describe('#3241 the constraint-vocab job exists and is appended', () => {
  it('is declared, with a human-readable name and an opt-out variable', () => {
    expect(jobStart, `${CI_FILE} must declare a constraint-vocab job (#3241)`).toBeGreaterThan(-1);
    expect(job).toContain('name: Constraint vocabulary against the chain-built catalog (#3241)');
    expect(job).toContain('if: vars.CONSTRAINT_VOCAB_GUARD_ENABLED != \'false\'');
  });

  it('is the LAST job in the file, so no register coordinate above it moved', () => {
    const jobKeys = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    expect(jobKeys.at(-1)).toBe('constraint-vocab');
    // The coordinates the register names — `ci.yml:221`, `:254`, `:401-409`, `:447`
    // — have to stay above the insertion point, which is what `guard:coords` reads.
    const jobLine = ci.slice(0, jobStart).split('\n').length;
    expect(jobLine).toBeGreaterThan(447);
  });

  it('runs the guard as the package.json alias, not a hand-copied command', () => {
    expect(pkg.scripts['guard:vocab']).toContain('scripts/check-constraint-vocab.mts');
    expect(stepBody('Positive control')).toContain('npm run guard:vocab');
    expect(stepBody('Negative control')).toContain('npm run guard:vocab');
  });
});

describe('#3241 it measures the database the migration chain produced', () => {
  it('starts its own Postgres and bootstraps the chain into it', () => {
    expect(job).toContain('image: postgres:16-alpine');
    expect(job).toContain('POSTGRES_DB: nucrm_vocab');
    expect(stepBody('Build the schema from the migration chain')).toContain('npm run db:bootstrap -- --yes');
    // The pushed schema would make the comparison tautological. Comments may name
    // it; a `run:` line may not.
    expect(job.replace(/#[^\n]*/g, '')).not.toContain('db:sync');
  });

  it('every guard step points at THIS job\'s database, not the file-level nucrm_test', () => {
    // ci.yml:11 sets DATABASE_URL to nucrm_test for the whole file. No service in
    // this job creates nucrm_test, so a step that forgot to re-export would have
    // the guard exit 2 ("cannot read pg_constraint") instead of measuring.
    for (const name of ['Positive control', 'Negative control', 'Build the schema from the migration chain']) {
      expect(stepBody(name), `${name} must export DATABASE_URL`).toContain(
        'export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nucrm_vocab',
      );
    }
  });
});

describe('#3241 the positive control reports what it measured', () => {
  it('fails the job on a nonzero guard exit rather than swallowing it', () => {
    const body = stepBody('Positive control');
    expect(body).toContain('set -uo pipefail');
    // tee alone would replace the guard's exit code with tee's.
    expect(body).toContain('npm run guard:vocab 2>&1 | tee');
    expect(body).toContain('code=${PIPESTATUS[0]}');
    expect(body).toContain('exit "$code"');
  });
});

describe('#3241 the negative control proves the screen fires', () => {
  const body = stepBody('Negative control');

  it('drops and re-adds the very constraint the registry reads', () => {
    const entry = registry.constraints.find((c) => c.id === 'invoices.status');
    expect(entry, 'scripts/constraint-vocab.json must still carry invoices.status').toBeDefined();
    expect(body).toContain(`ALTER TABLE ${entry!.table} DROP CONSTRAINT ${entry!.constraint}`);
    expect(body).toContain(`ADD CONSTRAINT ${entry!.constraint}`);
  });

  it('re-adds the registry list minus exactly one required value', () => {
    const entry = registry.constraints.find((c) => c.id === 'invoices.status')!;
    const literals = [...body.matchAll(/ARRAY\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']*)'/g)].map((v) => v[1]));
    expect(literals.length, 'the control must write its vocabulary inline, not echo the DB one').toBeGreaterThan(0);
    const removed = entry.required.filter((v) => !literals.includes(v));
    expect(removed, 'the control has to remove a value the code writes').toHaveLength(1);
    for (const keep of entry.required) if (keep !== removed[0]) expect(literals).toContain(keep);
    expect(entry.required).toContain('void');
    expect(literals).not.toContain('void');
  });

  it('requires a FAILURE from the guard, then requires the right reason', () => {
    // Passing is the bug: the step must treat exit 0 as the finding.
    expect(body).toMatch(/if npm run guard:vocab[^\n]*;\s*then/);
    expect(body).toContain('exit 1');
    expect(body).toContain('"id": "invoices.status"');
    expect(body).toContain("'void'");
    expect(body).toContain('guard-vocab-negative.log');
  });

  it('announces the contract it is asserting', () => {
    expect(job).toContain('a CHECK narrower than the code MUST turn the guard red');
  });
});
