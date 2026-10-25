/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3239 — the guard census in `docs/README.md` was measured by a command that
 * cannot produce the number the prose carries.
 *
 * Two defects, one shape. `docs/README.md:163` told every reader who wanted to
 * re-check the count to run `grep -n 'run: npm run guard'
 * .github/workflows/ci.yml` and read the line count off it. `ci.yml` chains three
 * aliases behind `&&` on one line and two on another, and an alias invoked inside a
 * `run: |` block sits on a line that does not contain the pattern at all — so the
 * grep reports fewer guards than the workflow runs, and the prose it was supposed
 * to check had drifted below the truth without the check ever disagreeing loudly.
 * That is the reasoning #2306 retracted for the role guards: a screen whose
 * arithmetic is wrong is a second opinion, not a check.
 *
 * The second defect is the same lie one level down. `scripts/check-migration-
 * redeclarations.mjs` justified leaving its alias unwired by naming a test that
 * asserts it, and that test has never existed on any branch
 * (`git log --all --diff-filter=A -- '*migration-redeclaration-screen*'` is empty).
 * `guard:migration-redecl` is genuinely asserted — from
 * `tests/unit/super-admin-audit-text-2510.test.ts:139` — but the pointer said
 * otherwise, and a phantom assertor makes an unwired guard read as wired.
 *
 * These tests read the replacement command out of the document and execute it:
 * against this repository, and against a synthetic workflow shaped exactly like the
 * case the grep misses. The census paragraph is checked against the workflow rather
 * than against a remembered number, so it stays checkable whichever way the tree
 * moves.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ROOT = join(import.meta.dirname!, '..', '..');

const readmeText = readFileSync(join(ROOT, 'docs/README.md'), 'utf8');
const ciText = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const aliasTotal = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts)
  .filter((k) => k.startsWith('guard:'));

/** Aliases a workflow text actually invokes: chained ones, `run: |` bodies, no comments. */
function aliasesInvoked(text: string): Set<string> {
  const body = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  return new Set([...body.matchAll(/npm run (guard:[a-z-]+)/g)].map((m) => m[1]));
}

/** The census command, taken from the document so this tests what a reader runs. */
function docCommand(): string {
  const line = readmeText.split('\n').find((l) => l.startsWith('node -e ') && l.includes('guard:[a-z-]+'));
  expect(line, 'docs/README.md must carry an alias-aware guard census command').toBeDefined();
  // The body is single-quoted and holds no single quote itself — it is one paste-able
  // line — so splitting on the delimiter is exact rather than clever.
  const parts = line!.split("'");
  expect(parts.length, 'the census command must quote its -e body exactly once').toBe(3);
  return parts[1];
}

function runDocCommand(cwd: string): string {
  return execFileSync('node', ['-e', docCommand()], { cwd, encoding: 'utf8' }).trim();
}

describe('the census paragraph is a claim about the workflow, not about grep (#3239)', () => {
  const invoked = aliasesInvoked(ciText);

  it('counts aliases, which a line-counting measure cannot', () => {
    expect(ciText).toMatch(/^\s*run:.*npm run guard:[a-z-]+ && npm run guard:/m);
    const runLines = ciText.split('\n').filter((l) => /^\s*run:.*npm run guard:/.test(l)).length;
    expect(invoked.size).toBeGreaterThan(runLines);
  });

  it('names only guards ci.yml really invokes, and as many as it says it names', () => {
    const para = readmeText.match(/enforces \*\*(\d+)\*\*[^—]*—([\s\S]*?)—\s*plus/);
    expect(para, 'the census paragraph must keep the shape this check reads').not.toBeNull();
    const named = [...para![2].matchAll(/`(guard:[a-z-]+)`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const alias of named) {
      expect(invoked.has(alias), `${alias} is enumerated but ci.yml does not invoke it`).toBe(true);
      expect(aliasTotal).toContain(alias);
    }
    expect(Number(para![1])).toBe(named.length);
  });

  it('still distinguishes the aliases no workflow runs from the ones the paragraph counts', () => {
    const unwired = aliasTotal.filter((a) => !invoked.has(a));
    expect(unwired.length).toBeGreaterThan(0);
    expect(unwired).toContain('guard:migration-redecl');
  });
});

describe('the documented measuring command measures (#3239)', () => {
  it('has replaced the line-counting grep', () => {
    expect(readmeText).not.toMatch(/grep -\w 'run: npm run guard'/);
    expect(readmeText).toContain('npm run (guard:[a-z-]+)');
  });

  it('against this repository prints the census the workflow supports', () => {
    const out = runDocCommand(ROOT);
    expect(out).toContain('guard aliases ci.yml runs');
    const [n, total] = out.match(/^(\d+)\/(\d+)/)!.slice(1).map(Number);
    expect(total).toBe(aliasTotal.length);
    expect(n).toBe(aliasesInvoked(ciText).size);
  });

  it('on a synthetic workflow counts chains and run-block bodies, and nothing from a comment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'census-3239-'));
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), [
        'jobs:',
        '  guards:',
        '    steps:',
        '      # npm run guard:mentioned-not-run — a comment, not an invocation',
        '      - run: npm run guard:alpha && npm run guard:beta',
        '      - run: |',
        '          set -euo pipefail',
        '          npm run guard:gamma 2>&1 | tee log.txt',
        '',
      ].join('\n'));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'census-fixture',
        scripts: {
          'guard:alpha': 'node a', 'guard:beta': 'node b', 'guard:gamma': 'node c',
          'guard:delta': 'node d', lint: 'eslint .',
        },
      }));
      expect(runDocCommand(dir)).toBe('3/4 guard aliases ci.yml runs');
      // The grep this replaced would have answered 1 line here, and 18 where 21 are run.
      const lines = readFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8')
        .split('\n').filter((l) => /^\s*run:.*npm run guard:/.test(l)).length;
      expect(lines).toBeLessThan(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('no script outsources its screen to a test that is not on disk (#3239)', () => {
  const POINTER = /tests(?:\/[A-Za-z0-9_\-.]+)+\.test\.tsx?(?![A-Za-z0-9_])/g;

  function scriptFiles(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) scriptFiles(p, acc);
      else if (/\.(mjs|cjs|js|ts)$/.test(e.name)) acc.push(p);
    }
    return acc;
  }

  it('every tests/*.test.ts pointer named under scripts/ resolves', () => {
    const files = scriptFiles(join(ROOT, 'scripts'));
    expect(files.length).toBeGreaterThan(50);
    const missing: string[] = [];
    for (const file of files) {
      for (const pointer of new Set(readFileSync(file, 'utf8').match(POINTER) ?? [])) {
        if (!existsSync(join(ROOT, pointer))) missing.push(`${file.slice(ROOT.length + 1)} -> ${pointer}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('the re-declaration screen names the assertor that really runs it, at the line that runs it', () => {
    const header = readFileSync(join(ROOT, 'scripts/check-migration-redeclarations.mjs'), 'utf8');
    expect(header).not.toMatch(/tests\/unit\/migration-redeclaration-screen/);
    const cited = header.match(/tests\/unit\/([a-z0-9-]+\.test\.ts):(\d+)/);
    expect(cited, 'the header must name a live assertor with a line number').not.toBeNull();
    const [, name, line] = cited!;
    const src = readFileSync(join(ROOT, 'tests/unit', name), 'utf8');
    expect(src).toContain('check-migration-redeclarations.mjs');
    expect(src.split('\n')[Number(line) - 1]).toContain('findRedclarations');
  });
});
