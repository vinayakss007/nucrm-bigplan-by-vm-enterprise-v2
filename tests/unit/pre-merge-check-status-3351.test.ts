/**
 * #3351 — `scripts/pre-merge-check.sh` could not fail.
 *
 * The file ran under `set -e` without `pipefail` and piped 6 of its 7 steps into
 * `head`/`tail`, so the pipeline's status was `head`'s or `tail`'s — always 0 — and
 * the script reached "ALL CHECKS PASSED — Ready to merge" over a tree where `tsc`,
 * the build, the unit suite or a guard had just failed. Each step also printed its
 * `✅` line unconditionally, right after the pipe.
 *
 * The screens that already read this file (`down-migration-coverage-3284`,
 * `prod-seed-refusal-3282`, `jsonb-size-octet-3283`) ask whether a guard APPEARS in
 * it. None of them could ask whether its exit status REACHES the shell, which is the
 * only question a gate answers. So this file does, twice over: statically, so a step
 * added as a bare piped command fails here, and behaviourally, by running the gate
 * against stub `npm`/`npx` that fail on demand and checking what the shell reports.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/pre-merge-check.sh');
const SRC = readFileSync(GATE, 'utf8');
// The file explains the bug it fixes, so structural checks read the executable
// lines only — a comment naming `| head -20` must not look like a step.
const CODE = SRC.split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');
const MARKERS = [...SRC.matchAll(/▶ (\d+)\/(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
// Read the step count off the file rather than pinning 7 here: #3335 is adding an
// eighth step to this same script, and a screen that hard-codes the denominator
// would fail a correct change. 3283/3284 own the "exactly 1..7" assertion.
const TOTAL = MARKERS.length;

const TMP: string[] = [];
const tempDir = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `3351-${name}-`));
  TMP.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of TMP) rmSync(dir, { recursive: true, force: true });
});

/**
 * Stubs, so the gate can be run end-to-end in a second instead of building the app.
 * Anything the gate asks `npm`/`npx` to run answers with 40 lines of noise, which is
 * also how the excerpt limit gets exercised: the step's real status has to survive
 * truncation, and a `| head` under `pipefail` would have lost it to SIGPIPE.
 */
function stubBin(opts: { failMatching?: string; failWith?: number } = {}) {
  const bin = tempDir('stubs');
  const body = (label: string) => `#!/usr/bin/env bash
echo "${label} $*"
for i in $(seq 1 40); do echo "noise $i"; done
FAIL='${opts.failMatching ?? ''}'
if [ -n "$FAIL" ] && [[ "$*" == *"$FAIL"* ]]; then echo "${label} FAILED"; exit ${opts.failWith ?? 3}; fi
exit 0
`;
  for (const name of ['npm', 'npx']) {
    const p = join(bin, name);
    writeFileSync(p, body(name));
    chmodSync(p, 0o755);
  }
  return bin;
}

function runGate(bin: string, cwd = ROOT) {
  return spawnSync('bash', [GATE], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
}

describe('#3351 the gate reads the status of what it runs', () => {
  it('runs under pipefail, not the bare set -e that made pipelines unobservable', () => {
    const second = SRC.split('\n')[1];
    expect(second).toBe('set -euo pipefail');
  });

  it('numbers every step, contiguously, under one denominator', () => {
    expect(TOTAL).toBeGreaterThanOrEqual(7);
    const denoms = new Set(MARKERS.map(([, d]) => d));
    expect([...denoms]).toEqual([TOTAL]);
    expect(MARKERS.map(([n]) => n)).toEqual(
      Array.from({ length: TOTAL }, (_, i) => i + 1)
    );
  });

  it('sends every command through the one helper that reads a status', () => {
    // The shape ask 4 asked for: a new step written as a bare piped command fails
    // here rather than silently joining the "everything passes" path.
    const bare = CODE.split('\n').filter((l) => /^\s*(npm run|npx )/.test(l));
    expect(bare).toEqual([]);
    // Every step but the hand-written import sanity check (#4) goes through run_step.
    expect([...CODE.matchAll(/^run_step /gm)].length).toBe(TOTAL - 1);
  });

  it('truncates captured output instead of piping the step command', () => {
    expect(SRC).toContain('|| status=$?');
    expect(CODE).not.toMatch(/^(?:npm run|npx ).*\| *(?:head|tail)/m);
    // A step that pipes into `head` cannot gain pipefail honestly: closing the pipe
    // kills the real command with SIGPIPE (141) on a successful run.
    expect(CODE).not.toContain('| head');
  });

  it('prints the success verdict only after the status was found to be zero', () => {
    const helper = SRC.slice(SRC.indexOf('run_step() {'), SRC.indexOf('\n}', SRC.indexOf('run_step() {')));
    expect(helper).toContain('if [ "$status" -ne 0 ]');
    expect(helper.indexOf('fail "Step')).toBeLessThan(helper.indexOf('echo "   ✅'));
  });

  it('reaches the banner only on a tree where every step answered zero', () => {
    expect([...CODE.matchAll(/ALL CHECKS PASSED/g)].length).toBe(1);
    expect(CODE.lastIndexOf('ALL CHECKS PASSED')).toBeGreaterThan(CODE.lastIndexOf('run_step "▶ 7/7'));
  });

  it('keeps the three guards the other screens pin this file for', () => {
    for (const alias of ['npm run guard:rollback-coverage', 'npm run guard:seed-credential', 'npm run guard:destructive-gate']) {
      expect(SRC).toContain(alias);
    }
    expect(SRC).not.toContain('guard:jsonb-size');
    expect(SRC).toContain('guard:migration-redecl has no step in pre-merge-check.sh');
  });
});

describe('#3351 the gate, run against stubs that fail on demand', () => {
  it('passes and says so when every step answers zero', () => {
    const res = runGate(stubBin());
    expect(res.stdout).toContain('ALL CHECKS PASSED — Ready to merge');
    expect(res.status).toBe(0);
    expect([...res.stdout.matchAll(/✅/g)].length).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it('stops on a failing typecheck and refuses to print the banner', () => {
    const res = runGate(stubBin({ failMatching: 'tsc' }));
    expect(res.status).not.toBe(0);
    expect(res.stdout).not.toContain('Ready to merge');
    expect(res.stdout).toContain('✖ Step 1/7');
    expect(res.stdout).toContain('exited 3');
  }, 60_000);

  it('stops on a failing build, which is the step whose whole point was truncated away', () => {
    const res = runGate(stubBin({ failMatching: 'run build' }));
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('✖ Step 2/7');
    expect(res.stdout).not.toContain('Ready to merge');
    // Steps 4 onward never ran, so their verdicts are absent rather than optimistic.
    expect(res.stdout).not.toContain('Rollback coverage');
  }, 60_000);

  it('stops on a failing guard, naming which one', () => {
    const res = runGate(stubBin({ failMatching: 'guard:destructive-gate' }));
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('✖ Step 7/7');
    expect(res.stdout).not.toContain('Ready to merge');
  }, 60_000);

  it('shows the failing step its own output even though the excerpt is bounded', () => {
    const res = runGate(stubBin({ failMatching: 'guard:seed-credential' }));
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('✖ Step 6/7');
    expect(res.stdout).toContain('No committed password literal (#3281)');
    expect(res.stdout).toContain('FAILED');
    // 40 noise lines per step, bounded: the gate reports, it does not dump the suite.
    expect(res.stdout.split('\n').length).toBeLessThan(120);
  }, 60_000);

  it('reports the old shape as the bug it is, by running it side by side', () => {
    // The regression proof, not a paraphrase: the pre-#3351 file exits 0 and prints
    // the banner with the same stub that makes the fixed file stop.
    const bin = stubBin({ failMatching: 'tsc' });
    const old = tempDir('old-gate');
    const path = join(old, 'pre-merge-check-old.sh');
    writeFileSync(
      path,
      `#!/usr/bin/env bash
set -e
npx tsc --noEmit --pretty 2>&1 | head -20
echo "   ✅ No TS errors"
echo "  ALL CHECKS PASSED — Ready to merge"
`
    );
    const res = spawnSync('bash', [path], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('ALL CHECKS PASSED');
    expect(res.stdout).toContain('✅ No TS errors');
  }, 60_000);
});

describe('#3351 step 4: a missing @/lib module is a decision, not a subshell accident', () => {
  /**
   * `echo "$NEW_IMPORTS" | while read …` ran the loop in a subshell, so the `exit 1`
   * inside it ended the subshell and the verdict came from the pipeline's status by
   * accident. A here-string keeps the loop in this shell, and the accumulated list
   * fails the step on purpose. Exercised in a throwaway repository because the step
   * reads `git diff origin/main...HEAD`.
   */
  function scratchRepo(imports: string) {
    const repo = tempDir('repo');
    const git = (...args: string[]) => {
      const r = spawnSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'gate', GIT_AUTHOR_EMAIL: 'gate@example.invalid',
          GIT_COMMITTER_NAME: 'gate', GIT_COMMITTER_EMAIL: 'gate@example.invalid',
        },
      });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout;
    };
    git('init', '-q', '--initial-branch=main');
    mkdirSync(join(repo, 'lib'), { recursive: true });
    writeFileSync(join(repo, 'lib/exists.ts'), 'export const exists = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    git('update-ref', 'refs/remotes/origin/main', base);
    git('checkout', '-qb', 'fix/scratch');
    mkdirSync(join(repo, 'app'), { recursive: true });
    writeFileSync(join(repo, 'app/page.ts'), `${imports}\nexport const page = 1;\n`);
    git('add', '-A');
    git('commit', '-qm', 'add an import');
    return repo;
  }

  it('fails the gate when a new @/lib import has no file behind it', () => {
    const repo = scratchRepo(`import { missing } from '@/lib/not-there';`);
    const res = runGate(stubBin(), repo);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('✖ Step 4/7');
    expect(res.stdout).toContain('lib/not-there.ts');
    expect(res.stdout).not.toContain('Ready to merge');
  }, 60_000);

  it('passes the step when the module exists, and still reaches the banner', () => {
    const repo = scratchRepo(`import { exists } from '@/lib/exists';`);
    writeFileSync(join(repo, 'lib/exists.ts'), 'export const exists = 1;\n');
    const res = runGate(stubBin(), repo);
    expect(res.stdout).toContain('✅ lib/exists.ts exists');
    expect(res.stdout).toContain('ALL CHECKS PASSED — Ready to merge');
    expect(res.status).toBe(0);
  }, 60_000);

  it('treats a branch with no new @/lib imports as a pass, not a pipeline failure', () => {
    // grep answers 1 when it matches nothing; under pipefail that used to be able to
    // end the step. `|| true` is what keeps "nothing to check" from becoming "failed".
    const repo = scratchRepo('export const plain = 1;');
    const res = runGate(stubBin(), repo);
    expect(res.stdout).toContain('No new @/lib imports');
    expect(res.status).toBe(0);
  }, 60_000);
});
