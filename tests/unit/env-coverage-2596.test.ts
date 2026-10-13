import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Tests for the env-coverage screen (#2596):
 *   - scripts/check-env-coverage.mjs        (`npm run guard:env-coverage`)
 *   - scripts/env-coverage-allowlist.json   reasoned exemptions
 *
 * The screen exists because an unset variable is indistinguishable from a
 * feature nobody wants: the code takes its default path, the deployment works,
 * and nothing anywhere says the knob was ever available. These tests run the
 * CLI the way CI does — spawnSync against a fixture root — so they assert exit
 * codes and report text, not internals.
 *
 * Every group gets its own fixture root. A shared one would make each test's
 * exit code depend on which files earlier tests left behind, and "expected 1,
 * received 0" tells you nothing about the screen when the real cause is a
 * neighbour's leftover.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-env-coverage.mjs');

type Fixture = {
  write: (rel: string, body: string) => void;
  run: (...args: string[]) => { code: number; out: string };
  dispose: () => void;
};

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'envcov-'));
  return {
    write(rel, body) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    },
    run(...args) {
      const res = spawnSync('node', [SCRIPT, '--root', dir, ...args], { encoding: 'utf8' });
      return { code: res.status, out: `${res.stdout}${res.stderr}` };
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A root with nothing covered: every name in it is undocumented. */
function bare(): Fixture {
  const f = fixture();
  f.write('.env.example', '# empty\n');
  f.write('scripts/env-coverage-allowlist.json', JSON.stringify({ entries: [] }));
  return f;
}

describe('the committed repository state', () => {
  it('passes the screen — no variable is read without being documented or allowlisted', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    const out = `${res.stdout}${res.stderr}`;
    expect(out).toContain('OK — every environment variable');
    expect(res.status).toBe(0);
  }, 120_000);

  it('reports every allowlist entry as live, so exemptions cannot outlive their code', () => {
    const res = spawnSync('node', [SCRIPT, '--json'], { cwd: ROOT, encoding: 'utf8' });
    const parsed = JSON.parse(res.stdout);
    expect(parsed.staleAllowlistEntries).toEqual([]);
    expect(parsed.undocumented).toEqual([]);
    expect(parsed.namesRead).toBeGreaterThan(100);
  }, 120_000);
});

describe('read sites it must find', () => {
  let f: Fixture;
  beforeEach(() => {
    f?.dispose();
    f = bare();
  });
  afterAll(() => f.dispose());

  it('catches all four spellings a name can be read with', () => {
    f.write(
      'app/forms.ts',
      [
        'const a = process.env.DOTTED_NAME;',
        "const b = process.env['BRACKET_NAME'];",
        'const c = process.env["DOUBLE_NAME"];',
        'const d = `x ${process.env.TEMPLATE_NAME} y`;',
        'function getOptionalEnv(n: string, v?: string) { return process.env[n] ?? v; }',
        "const e = getOptionalEnv('HELPER_NAME');",
        'export { a, b, c, d, e };',
      ].join('\n'),
    );
    const { code, out } = f.run('--list-undocumented');
    expect(code).toBe(1);
    for (const name of ['DOTTED_NAME', 'BRACKET_NAME', 'DOUBLE_NAME', 'TEMPLATE_NAME', 'HELPER_NAME']) {
      expect(out).toContain(name);
    }
  });

  it('reports the file and line of the first read so a fix is findable', () => {
    f.write('app/located.ts', 'const x = process.env.AT_A_LINE;');
    const { out } = f.run('--list-undocumented');
    expect(out).toMatch(/AT_A_LINE\tapp\/located\.ts:1/);
  });

  it('walks root entrypoints as well as source directories', () => {
    f.write('worker.ts', 'const w = process.env.ENTRYPOINT_NAME;');
    const { out } = f.run('--list-undocumented');
    expect(out).toContain('ENTRYPOINT_NAME');
  });
});

describe('non-reads it must ignore', () => {
  let f: Fixture;
  beforeEach(() => {
    f?.dispose();
    f = bare();
  });
  afterAll(() => f.dispose());

  it('does not count a name that only appears in a comment', () => {
    f.write(
      'app/prose.ts',
      [
        '// operators sometimes set COMMENT_NAME to work around this',
        '/* BLOCK_COMMENT_NAME is not a variable either */',
        'export const value = 1;',
      ].join('\n'),
    );
    const { code, out } = f.run('--list-undocumented');
    expect(code).toBe(0);
    expect(out).toBe('');
  });

  it('still counts a real read on a line that also carries a trailing comment', () => {
    f.write('app/mixed.ts', 'const x = process.env.REAL_READ; // explains REAL_READ away');
    const { out } = f.run('--list-undocumented');
    expect(out).toContain('REAL_READ');
  });

  it('keeps line numbers true after blanking a multi-line block comment', () => {
    f.write(
      'app/numbered.ts',
      ['/*', ' * BLOCK_HEADER', ' * spreads over three lines', ' */', 'const y = process.env.LOWER_READ;'].join('\n'),
    );
    const { out } = f.run('--list-undocumented');
    expect(out).toMatch(/LOWER_READ\tapp\/numbered\.ts:5/);
  });

  it('ignores directories that are not source', () => {
    f.write('app/clean.ts', 'export const value = 1;');
    f.write('node_modules/pkg/vendored.ts', 'const z = process.env.VENDORED_NAME;');
    f.write('.next/generated.ts', 'const z = process.env.GENERATED_NAME;');
    const { code, out } = f.run('--list-undocumented');
    expect(code).toBe(0);
    expect(out).not.toContain('VENDORED_NAME');
    expect(out).not.toContain('GENERATED_NAME');
  });
});

describe('how a name can become covered', () => {
  let f: Fixture;
  beforeEach(() => {
    f?.dispose();
    f = bare();
    f.write(
      'app/one.ts',
      'const a = process.env.COVERED_NAME;\nconst b = process.env.EXEMPT_NAME;',
    );
  });
  afterAll(() => f.dispose());

  it('counts an uncommented assignment in .env.example', () => {
    f.write('.env.example', 'COVERED_NAME=\n');
    const { code, out } = f.run('--list-undocumented');
    expect(out).not.toContain('COVERED_NAME');
    expect(out).toContain('EXEMPT_NAME');
    expect(code).toBe(1);
  });

  it('counts a commented-out entry, which is present and explained', () => {
    f.write('.env.example', '# the knob exists, off by default\n# COVERED_NAME=\n');
    const { out } = f.run('--list-undocumented');
    expect(out).not.toContain('COVERED_NAME');
  });

  it('does not count a bare mention with no assignment, so prose is not coverage', () => {
    f.write('.env.example', '# COVERED_NAME is what you should set\n');
    const { out } = f.run('--list-undocumented');
    expect(out).toContain('COVERED_NAME');
  });

  it('counts an allowlist entry that carries a reason', () => {
    f.write(
      'scripts/env-coverage-allowlist.json',
      JSON.stringify({ entries: [{ name: 'EXEMPT_NAME', reason: 'set by the runner, not an operator' }] }),
    );
    f.write('.env.example', 'COVERED_NAME=\n');
    const { code, out } = f.run();
    expect(code).toBe(0);
    expect(out).toContain('OK —');
  });

  it('fails an allowlist entry whose read site has gone', () => {
    f.write(
      'scripts/env-coverage-allowlist.json',
      JSON.stringify({
        entries: [
          { name: 'EXEMPT_NAME', reason: 'set by the runner, not an operator' },
          { name: 'GONE_NAME', reason: 'this code was deleted last month' },
        ],
      }),
    );
    const { code, out } = f.run();
    expect(code).toBe(1);
    expect(out).toContain('GONE_NAME');
    expect(out).toContain('matches no read site any more');
  });
});

describe('a screen that cannot fail is not a screen', () => {
  it('refuses to run against a root with no .env.example', () => {
    const empty = mkdtempSync(join(tmpdir(), 'envcov-empty-'));
    const res = spawnSync('node', [SCRIPT, '--root', empty], { encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('.env.example not found');
    rmSync(empty, { recursive: true, force: true });
  });
});
