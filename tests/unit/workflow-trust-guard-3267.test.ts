import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * #3267 — the standing constraint on the host is *do not register the
 * self-hosted runner before the guard lands*. Nothing in the pipeline asserted
 * any of that: `workflow-lint.yml` runs actionlint (parse errors) and
 * `check-deploy-trigger.mjs` (name/branch wiring), and both stay green for a PR
 * that puts `runs-on: self-hosted` on a `pull_request` job, deletes the
 * `branches: [main]` filter from a `workflow_run` trigger, or drops the
 * `permissions:` block a workflow was relying on.
 *
 * The screen is fixture-driven because the unsafe shapes do not exist on `main`
 * yet — a test that only ran against the real tree would prove nothing about
 * whether it can see them.
 */

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-workflow-trust.mjs');

function run(workflowsDir: string) {
  const res = spawnSync(process.execPath, [SCRIPT, workflowsDir], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

let dir: string;
const written: string[] = [];
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wftrust-3267-vm-'));
});
afterEach(() => {
  for (const file of written.splice(0)) rmSync(file, { force: true });
});

function only(name: string, yaml: string) {
  for (const file of written.splice(0)) rmSync(file, { force: true });
  const path = join(dir, `${name}.yml`);
  writeFileSync(path, yaml);
  written.push(path);
}

describe('check-workflow-trust sees the fork trust boundary (#3267)', () => {
  it('reports the real repo clean — the guard is not red on arrival', () => {
    const { code, out } = run(join(ROOT, '.github', 'workflows'));
    expect(out).toMatch(/OK/);
    expect(code).toBe(0);
  });

  it('fails a pull_request job that reads a real secret, and accepts the fallback form', () => {
    only(
      'leaky',
      `name: Leaky
on: pull_request
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: node x.js
        env:
          TOKEN: \${{ secrets.DEPLOY_SSH_KEY }}
`,
    );
    const bad = run(dir);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toMatch(/leaky\.yml/);
    expect(bad.out).toMatch(/DEPLOY_SSH_KEY/);
    // Never the value — the screen reads names out of the YAML text only.
    expect(bad.out).not.toMatch(/PRIVATE KEY/);

    only(
      'fallback',
      `name: Fallback
on: pull_request
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: node x.js
        env:
          JWT_SECRET: \${{ secrets.JWT_SECRET || 'ci-jwt-secret-safe-value-32chars-long-enough-x' }}
`,
    );
    const good = run(dir);
    expect(good.out).toMatch(/OK/);
    expect(good.code).toBe(0);
  });

  it('accepts a head-repo equality guard on a secret-reading pull_request job', () => {
    only(
      'guarded',
      `name: Guarded
on: pull_request
permissions:
  contents: read
jobs:
  a:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - run: node x.js
        env:
          PREPROD_DATABASE_URL: \${{ secrets.PREPROD_DATABASE_URL }}
`,
    );
    const { code, out } = run(dir);
    expect(out).toMatch(/OK/);
    expect(code).toBe(0);
  });

  it('fails any job on a self-hosted runner in a fork-reachable workflow, guard or no guard', () => {
    only(
      'runner',
      `name: Runner
on:
  pull_request:
  push:
permissions:
  contents: read
jobs:
  a:
    runs-on: [self-hosted, linux]
    steps:
      - run: node x.js
`,
    );
    const bad = run(dir);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toMatch(/self-hosted/);

    only(
      'runner-ok',
      `name: RunnerOk
on:
  workflow_dispatch:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  a:
    runs-on: [self-hosted, linux]
    steps:
      - run: node x.js
`,
    );
    const good = run(dir);
    expect(good.out).toMatch(/OK/);
    expect(good.code).toBe(0);
  });

  it('fails pull_request_target outright — fork code must not run with base-context secrets', () => {
    only(
      'pwt',
      `name: Pwt
on: pull_request_target
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`,
    );
    const { code, out } = run(dir);
    expect(code).not.toBe(0);
    expect(out).toMatch(/pull_request_target/);
  });

  it('fails a workflow_run trigger that lost its branch filter or its conclusion gate', () => {
    only(
      'wfr-nobranch',
      `name: WfrNoBranch
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: node x.js
        env:
          DEPLOY_HOST: \${{ secrets.DEPLOY_HOST }}
`,
    );
    const noBranch = run(dir);
    expect(noBranch.code).not.toBe(0);
    expect(noBranch.out).toMatch(/branches/);

    only(
      'wfr-noconclusion',
      `name: WfrNoConclusion
on:
  workflow_run:
    workflows: ["CI"]
    branches: [main]
    types: [completed]
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: node x.js
        env:
          DEPLOY_HOST: \${{ secrets.DEPLOY_HOST }}
`,
    );
    const noGate = run(dir);
    expect(noGate.code).not.toBe(0);
    expect(noGate.out).toMatch(/conclusion/);

    only(
      'wfr-ok',
      `name: WfrOk
on:
  workflow_run:
    workflows: ["CI"]
    branches: [main]
    types: [completed]
permissions:
  contents: read
jobs:
  a:
    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: node x.js
        env:
          DEPLOY_HOST: \${{ secrets.DEPLOY_HOST }}
`,
    );
    const ok = run(dir);
    expect(ok.out).toMatch(/OK/);
    expect(ok.code).toBe(0);
  });

  it('names a deploy-secret job that is not scoped to an environment', () => {
    only(
      'noenv',
      `name: NoEnv
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ssh deploy@\$host
        env:
          DEPLOY_SSH_KEY: \${{ secrets.DEPLOY_SSH_KEY }}
`,
    );
    const { code, out } = run(dir);
    expect(code).not.toBe(0);
    expect(out).toMatch(/environment/i);
  });

  it('fails a workflow with no top-level permissions block, and accepts an empty one', () => {
    only(
      'noperm',
      `name: NoPerm
on:
  workflow_dispatch:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: node x.js
`,
    );
    const bad = run(dir);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toMatch(/permissions/);

    only(
      'emptyperm',
      `name: EmptyPerm
on:
  workflow_dispatch:
permissions: {}
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: node x.js
`,
    );
    const good = run(dir);
    expect(good.out).toMatch(/OK/);
    expect(good.code).toBe(0);
  });
});
