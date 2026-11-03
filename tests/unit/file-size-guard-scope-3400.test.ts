/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3400 — the file-size ratchet has to be able to answer a question about ONE
 * file, because 89 suites used to ask it about the whole repository and assert
 * exit 0. When `app/(marketing)/page.tsx` ran 16 lines over its baseline, that
 * single number failed 88 of them: `main` measured 100 failed test files for one
 * JSON entry. The fix is `--only`, and the fix is only trustworthy if a scope
 * that names nothing FAILS — otherwise the sweep would have traded 88 red files
 * for 89 green files that guard nothing.
 *
 * So this suite has three jobs: the scope answers correctly (green on a file
 * that complies while the repo-wide run is red), the scope refuses to be empty
 * or bogus (every fail-closed path), and the sweep is permanent — no suite in
 * `tests/**` may invoke the guard unscoped again, and no suite may scope to a
 * path that does not exist.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/check-file-size.mjs');

function guard(args: string[], cwd = ROOT) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

/** A tree with one oversized file, one compliant file, and a baseline that
 *  grandfathers the oversized one — the shape that produced the amplification. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'filesize-scope-3400-'));
  for (const root of ['app', 'lib', 'components', 'scripts']) mkdirSync(join(dir, root), { recursive: true });
  const big = Array.from({ length: 900 }, (_, i) => `// line ${i}`).join('\n');
  writeFileSync(join(dir, 'app', 'big.tsx'), big + '\n');
  writeFileSync(join(dir, 'app', 'small.tsx'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'lib', 'quiet.ts'), 'export const y = 2;\n');
  writeFileSync(join(dir, 'components', 'empty.ts'), '');
  writeFileSync(join(dir, 'scripts', 'file-size-baseline.json'), JSON.stringify({ 'app/big.tsx': 800 }, null, 2) + '\n');
  return dir;
}

describe('#3400 the ratchet can be asked about one file', () => {
  it('is red repo-wide while the file this suite owns is clean', () => {
    const dir = fixture();
    try {
      const whole = guard([], dir);
      expect(whole.status, whole.stdout + whole.stderr).toBe(1);
      expect(whole.stderr).toMatch(/app\/big\.tsx \(900 > baseline 800\)/);
      // The point of the whole change: an unrelated overage cannot reach a
      // scoped caller. Pre-#3400 these two assertions were the same file.
      const scoped = guard(['--only', 'lib/quiet.ts'], dir);
      expect(scoped.status, scoped.stdout + scoped.stderr).toBe(0);
      expect(scoped.stdout).toContain('OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is red when the scoped file itself is the offender', () => {
    const dir = fixture();
    try {
      const res = guard(['--only', 'app/big.tsx'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/app\/big\.tsx \(900 > baseline 800\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies the new-file ceiling to a scoped file that has no baseline entry', () => {
    const dir = fixture();
    try {
      writeFileSync(join(dir, 'app', 'novel.tsx'), Array.from({ length: 600 }, (_, i) => `// ${i}`).join('\n') + '\n');
      const res = guard(['--only', 'app/novel.tsx'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/New file\(s\) exceed 500 lines/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes several scopes, and repeats, spreads and commas all work', () => {
    const dir = fixture();
    try {
      // The argv-array form is what a spawnSync caller writes: '--only', a, b.
      const spread = JSON.parse(guard(['--only', 'lib/quiet.ts', 'app/small.tsx', '--json'], dir).stdout);
      expect(spread.scanned).toBe(2);
      const twice = guard(['--only', 'lib/quiet.ts', '--only', 'app/small.tsx'], dir);
      expect(twice.status, twice.stdout + twice.stderr).toBe(0);
      expect(JSON.parse(guard(['--only', 'lib/quiet.ts,app/small.tsx', '--json'], dir).stdout).scanned).toBe(2);
      // A repeated name is one file, not two — `scanned` stays honest.
      expect(JSON.parse(guard(['--only', 'lib/quiet.ts', 'lib/quiet.ts', '--json'], dir).stdout).scanned).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still prints the ratchet hint for the file it was asked about, and only that file', () => {
    const dir = fixture();
    try {
      writeFileSync(join(dir, 'app', 'shrunk.tsx'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'scripts', 'file-size-baseline.json'), JSON.stringify({ 'app/big.tsx': 900, 'app/shrunk.tsx': 700 }, null, 2) + '\n');
      const scoped = guard(['--only', 'app/shrunk.tsx'], dir);
      expect(scoped.status, scoped.stdout + scoped.stderr).toBe(0);
      expect(scoped.stdout).toContain('remove them from the baseline');
      expect(scoped.stdout).not.toContain('app/big.tsx');
      // …and repo-wide it is still the same two-file report it always was.
      expect(guard([], dir).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#3400 a scope that names nothing is a failure, never an OK', () => {
  const bad: Array<[string, RegExp]> = [
    ['app/no-such-panel/page.tsx', /does not exist/],
    ['scripts/check-file-size.mjs', /is not under app, lib, components/],
    ['package.json', /not a \.ts\/\.tsx source file/],
    ['../elsewhere/app/x.ts', /outside the repository root/],
    ['/app/x.ts', /outside the repository root/],
  ];

  it.each(bad)('refuses the scope %s', (arg, pattern) => {
    const res = guard(['--only', arg]);
    expect(res.status, `${arg}: ${res.stdout}${res.stderr}`).toBe(1);
    expect(res.stderr).toMatch(pattern);
    expect(res.stdout).not.toContain('OK');
  });

  it('refuses an --only with no value at all', () => {
    const res = guard(['--only']);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/--only needs a file path/);
  });

  it('refuses an argument it does not understand rather than scanning everything', () => {
    // A misspelled flag that fell back to the repo-wide walk would report OK
    // about a thousand files a suite has no opinion about.
    const res = guard(['--onlyy', 'app/(marketing)/page.tsx']);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/unknown argument "--onlyy"/);
  });

  it('fails closed when the tree cannot be walked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'filesize-unwalkable-3400-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, 'scripts', 'file-size-baseline.json'), '{}\n');
      const res = guard([], dir);
      expect(res.status).toBe(1);
      expect(res.stdout).not.toContain('OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#3400 the sweep is an invariant, not a one-off', () => {
  const suites = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.test\.tsx?$/.test(name)) out.push(p);
      }
    };
    walk(join(ROOT, 'tests'));
    return out;
  })();
  // This file asks the guard repo-wide questions on purpose, inside fixtures.
  const callers = suites.filter((f) => readFileSync(f, 'utf8').includes('check-file-size.mjs') && !f.endsWith('file-size-guard-scope-3400.test.ts'));

  it('covers the whole family, so the count below cannot quietly drop', () => {
    expect(callers.length).toBeGreaterThanOrEqual(88);
  });

  it('invokes the guard with a scope at every single call site', () => {
    for (const file of callers) {
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        if (!/spawnSync/.test(line) || !/check-file-size\.mjs/.test(line)) continue;
        expect(line, `${file} spawns the repo-wide guard — an overage anywhere will fail this suite`).toMatch(/--only|\.\.\.scope/);
      }
      // A loop over several guards scopes it with a ternary; make sure the
      // ternary is really there, since the spawn line itself never names the
      // script in that shape.
      if (/for \(const script of \[[^\]]*check-file-size/.test(src)) {
        expect(src, `${file} loops over the guards without scoping the size one`).toMatch(/check-file-size\.mjs'\s*\?\s*\['--only'/);
      }
    }
  });

  it('never scopes to a file that has stopped existing', () => {
    // The guard refuses these at run time; this refuses them at review time.
    for (const file of callers) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/['"`]((?:app|components|lib)\/[^'"`\s]+?\.(?:ts|tsx))['"`]/g)) {
        // A path built by a template (`app/tenant/ai/${p}/page.tsx`) is checked
        // by the guard itself when the suite runs; only literals can be checked
        // here.
        if (m[1].includes('${')) continue;
        expect(existsSync(join(ROOT, m[1])), `${file} scopes the ratchet to ${m[1]}, which is not in the tree`).toBe(true);
      }
    }
  });
});

describe('#3400 the machine-readable answer', () => {
  it('reports scope, offenders and shrunk files as data', () => {
    const dir = fixture();
    try {
      const json = JSON.parse(guard(['--only', 'app/big.tsx', '--only', 'lib/quiet.ts', '--json'], dir).stdout);
      expect(json.scoped).toBe(true);
      expect(json.scope).toEqual(['app/big.tsx', 'lib/quiet.ts']);
      expect(json.maxLines).toBe(500);
      expect(json.scanned).toBe(2);
      expect(json.offenders).toEqual([{ file: 'app/big.tsx', lines: 900, base: 800, kind: 'grown' }]);
      expect(json.shrunk).toEqual([]);
      expect(json.scopeProblems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the repo-wide sentence the CI step prints, byte for byte', () => {
    const dir = fixture();
    try {
      writeFileSync(join(dir, 'scripts', 'file-size-baseline.json'), JSON.stringify({ 'app/big.tsx': 900 }, null, 2) + '\n');
      const res = guard([], dir);
      expect(res.stdout, res.stdout + res.stderr).toMatch(
        /^\[check-file-size\] OK — \d+ files scanned; no new >500-line files, no grandfathered file grew\.\n$/,
      );
      expect(res.stdout).not.toContain('(scoped to --only)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the scope in the human line so a scoped OK cannot be read as a repo-wide one', () => {
    const dir = fixture();
    try {
      expect(guard(['--only', 'lib/quiet.ts'], dir).stdout).toContain('1 file(s) scanned (scoped to --only)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
