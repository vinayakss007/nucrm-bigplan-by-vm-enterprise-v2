/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3413 — `scripts/**` is excluded from the root typecheck, so the directory
 * that touches the database was never type-checked and no CI job noticed.
 *
 * Two halves, asserted here:
 *
 *  1. The bugs the blind spot hid are gone: the duplicate `import { pgSslConfig }`
 *     lines #3381 shipped, and the two names `drift-check.ts`'s `--json` branch
 *     has referenced since #2508 without existing.
 *  2. The screen that keeps them gone: `scripts/tsconfig.scripts.json` gives the
 *     directory a typecheck path, and
 *     `scripts/check-scripts-typecheck.mjs` pins what it currently finds as a
 *     shrink-only floor — a new error fails, a fixed one fails until the entry
 *     comes down, and a line-number shift changes nothing, because the identity
 *     of an entry is file + code + message.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname!, '../..');
const SCRIPT = join(ROOT, 'scripts/check-scripts-typecheck.mjs');
const TSCONFIG_REL = 'scripts/tsconfig.scripts.json';
const BASELINE_REL = 'scripts/scripts-ts-baseline.json';

type Diagnostic = { file: string; line: number; code: string; message: string };
type Entry = { file: string; code: string; message: string; count: number };

// tsc on the scripts project costs about a minute, so the transcript is taken
// once for the file and every assertion reads from it.
let diagnostics: Diagnostic[];
let real: { errors: number; files: number; findings: unknown[]; stale: unknown[]; ok: boolean };
let mod: typeof import('../../scripts/check-scripts-typecheck.mjs');

beforeAll(async () => {
  mod = await import('../../scripts/check-scripts-typecheck.mjs');
  diagnostics = mod.typecheck(ROOT);
  real = mod.run(ROOT, diagnostics);
}, 300_000);

function cli(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

/** A root whose floor is exactly `entries`, plus a captured transcript. */
function fixture(entries: Entry[], transcript: string) {
  const root = mkdtempSync(join(tmpdir(), 'scripts-ts-floor-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, BASELINE_REL), JSON.stringify({ entries }));
  const log = join(root, 'tsc.log');
  writeFileSync(log, transcript);
  return { root, log };
}

describe('#3413 the blind spot itself', () => {
  it('leaves scripts/** out of the root project, which is how it stayed invisible', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
    expect(cfg.exclude).toContain('scripts/**');
  });

  it('gives the directory a typecheck project that really covers it', () => {
    expect(existsSync(join(ROOT, TSCONFIG_REL))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(ROOT, TSCONFIG_REL), 'utf8'));
    expect(cfg.include).toEqual(['./**/*.ts']);
    expect(cfg.exclude, 'the root config excludes scripts; inheriting that would check nothing').toEqual([]);
    expect(cfg.compilerOptions.incremental, 'a .tsbuildinfo in the tree rots like every other pinned line').toBe(false);
  });

  it('the scripts project arrives free of the identifier classes #3381 and #2508 shipped', () => {
    expect(diagnostics.filter((d) => d.code === 'TS2300')).toEqual([]);
    expect(diagnostics.filter((d) => d.code === 'TS2304' || d.code === 'TS18004')).toEqual([]);
  });
});

describe('#3413 the bugs that fix is about', () => {
  const files = [
    'scripts/restore-db.ts',
    'scripts/db-state.ts',
    'scripts/drop-all.ts',
    'scripts/migration-runner.ts',
    'scripts/seed-dev.ts',
    'scripts/simulate-preprod-flows.ts',
    'scripts/verify-migration-chain.ts',
    'scripts/seed-fresh.ts',
  ];

  for (const f of files) {
    it(`${f} imports the TLS policy exactly once`, () => {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const imports = src.split('\n').filter((l) => /^import .*pgSslConfig.*from/.test(l));
      expect(imports, `${f} carries ${imports.length} pgSslConfig import(s)`).toHaveLength(1);
      expect(imports[0]).toMatch(/ssl-config['"]/);
    });
  }

  it('drift-check.ts --json names only identifiers that exist in its scope', () => {
    const src = readFileSync(join(ROOT, 'scripts/drift-check.ts'), 'utf8');
    const branch = /if \(process\.argv\.includes\('--json'\)\) \{[\s\S]*?\n {4}\}/.exec(src);
    expect(branch, 'the --json branch moved; update this check').not.toBeNull();
    expect(branch![0]).not.toMatch(/columnFindings/);
    expect(branch![0]).toContain('findings: fresh,');
    expect(branch![0]).toContain('columnsCompared: comparison.columnsCompared,');
    expect(src).toMatch(/const \{ fresh, masked, stale: staleAllow \} = splitByAllowlist\(comparison\.findings, allowlist\);/);
  });

  it('migrate.ts imports the helper its recovery path calls', () => {
    const src = readFileSync(join(ROOT, 'scripts/migrate.ts'), 'utf8');
    const imported = /import \{([^}]*)\} from '\.\/migrate-recovery';/.exec(src);
    expect(imported, 'the migrate-recovery import was rewritten').not.toBeNull();
    expect(imported![1]).toContain('groupMissingByOwner');
    expect(src).toMatch(/groupMissingByOwner\(buildMissing\)/);
    expect(readFileSync(join(ROOT, 'scripts/migrate-recovery.ts'), 'utf8')).toMatch(/export function groupMissingByOwner/);
  });
});

describe('#3413 the floor is the contract, not a number', () => {
  it('the real tree arrives exactly as baselined', () => {
    expect(real.findings).toEqual([]);
    expect(real.stale).toEqual([]);
    expect(real.ok).toBe(true);
    const entries = JSON.parse(readFileSync(join(ROOT, BASELINE_REL), 'utf8')).entries as Entry[];
    expect(real.errors).toBe(entries.reduce((n, e) => n + e.count, 0));
    expect(real.errors).toBeGreaterThanOrEqual(100);
    expect(real.files).toBeGreaterThanOrEqual(15);
  });

  it('identifies an error without its line, so editing ten lines above it is not a regression', () => {
    const a: Diagnostic = { file: 'scripts/x.ts', line: 12, code: 'TS2322', message: 'Type T is not assignable.' };
    const moved: Diagnostic = { ...a, line: 480 };
    expect(mod.keyOf(a)).toBe(mod.keyOf(moved));
    const entries: Entry[] = [{ file: a.file, code: a.code, message: a.message, count: 2 }];
    expect(mod.compare(entries, [a, moved])).toEqual({ findings: [], stale: [] });
  });

  it('survives a message that contains the key separator', () => {
    const d: Diagnostic = {
      file: 'scripts/x.ts',
      line: 3,
      code: 'TS2345',
      message: "Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
    };
    const entries: Entry[] = [{ file: d.file, code: d.code, message: d.message, count: 1 }];
    expect(mod.compare(entries, [d])).toEqual({ findings: [], stale: [] });
  });

  it('fails a type error the floor has never seen, naming the file and the code', () => {
    const known: Diagnostic = { file: 'scripts/a.ts', line: 5, code: 'TS2322', message: 'known' };
    const fresh: Diagnostic = { file: 'scripts/b.ts', line: 9, code: 'TS2304', message: "Cannot find name 'nope'." };
    const out = mod.compare([{ ...known, count: 1 }], [known, fresh]);
    expect(out.findings).toEqual([fresh]);
    expect(out.stale).toEqual([]);
  });

  it('is shrink-only: a fix the floor has not been told about is a failure too', () => {
    const entries: Entry[] = [
      { file: 'scripts/a.ts', code: 'TS2322', message: 'one', count: 3 },
      { file: 'scripts/z.ts', code: 'TS2532', message: 'gone', count: 1 },
    ];
    const seen: Diagnostic[] = [
      { file: 'scripts/a.ts', line: 1, code: 'TS2322', message: 'one' },
      { file: 'scripts/a.ts', line: 2, code: 'TS2322', message: 'one' },
    ];
    const out = mod.compare(entries, seen);
    expect(out.findings).toEqual([]);
    expect(out.stale).toEqual([
      { file: 'scripts/a.ts', code: 'TS2322', message: 'one', expected: 3, actual: 2 },
      { file: 'scripts/z.ts', code: 'TS2532', message: 'gone', expected: 1, actual: 0 },
    ]);
    expect(out.stale.length, 'an exemption cannot outlive its code').toBe(2);
  });

  it('a malformed or duplicated floor entry is refused before any verdict', () => {
    const root = mkdtempSync(join(tmpdir(), 'scripts-ts-load-'));
    mkdirSync(join(root, 'scripts'), { recursive: true });
    const put = (doc: unknown) => writeFileSync(join(root, BASELINE_REL), JSON.stringify(doc));
    expect(() => mod.loadBaseline(root)).toThrow(/missing/);
    put({});
    expect(() => mod.loadBaseline(root)).toThrow(/no entries array/);
    put({ entries: [{ file: 'a.ts', code: 'TS1', message: 'x' }] });
    expect(() => mod.loadBaseline(root)).toThrow(/positive integer count/);
    put({ entries: [{ file: 'a.ts', code: 'TS1', message: 'x', count: 0 }] });
    expect(() => mod.loadBaseline(root)).toThrow(/positive integer count/);
    put({
      entries: [
        { file: 'a.ts', code: 'TS1', message: 'x', count: 1 },
        { file: 'a.ts', code: 'TS1', message: 'x', count: 2 },
      ],
    });
    expect(() => mod.loadBaseline(root)).toThrow(/twice/);
    put({ entries: [{ file: 'a.ts', code: 'TS1', message: 'x', count: 1 }] });
    expect(mod.loadBaseline(root)).toHaveLength(1);
  });

  it('the committed floor is valid, sorted and free of line numbers', () => {
    const raw = readFileSync(join(ROOT, BASELINE_REL), 'utf8');
    expect(raw).toMatch(/"_comment"/);
    const doc = JSON.parse(raw);
    expect(() => mod.loadBaseline(ROOT)).not.toThrow();
    expect(doc.entries.every((e: Entry) => e.count >= 1)).toBe(true);
    expect(Object.keys(doc.entries[0]).sort()).toEqual(['code', 'count', 'file', 'message']);
    expect(doc.entries.some((e: Entry) => 'line' in e)).toBe(false);
  });
});

describe('#3413 the screen runs as a command', () => {
  /**
   * The transcript the real `tsc` run produced, replayed through the CLI so the
   * wording and the exit code are asserted without paying for a second minute
   * of compilation.
   */
  function transcript() {
    const root = mkdtempSync(join(tmpdir(), 'scripts-ts-replay-'));
    const log = join(root, 'tsc.log');
    writeFileSync(log, diagnostics.map((d) => `${d.file}(${d.line},1): error ${d.code}: ${d.message}`).join('\n') + '\n');
    return log;
  }

  it('exits 0 on the tree it guards and says which floor it checked', () => {
    const res = cli(['--from-file', transcript(), ROOT]);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(/OK — \d+ type error\(s\) across \d+ script file\(s\), every one recorded/);
  });

  it('--json answers with the same arithmetic the human line prints', () => {
    const res = cli(['--from-file', transcript(), ROOT, '--json']);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.ok).toBe(true);
    expect(out.findings).toEqual([]);
    expect(out.stale).toEqual([]);
    expect(out.errors).toBe(real.errors);
  });

  it('and the command the operator runs really compiles the scripts project', () => {
    const res = cli([]);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(/OK — \d+ type error\(s\)/);
  }, 240_000);

  it('a planted new error is a red command, not a note', () => {
    const { root, log } = fixture([{ file: 'scripts/a.ts', code: 'TS2322', message: 'known', count: 1 }],
      'scripts/a.ts(4,9): error TS2322: known\nscripts/b.ts(7,1): error TS2304: Cannot find name x.\n');
    const res = cli(['--from-file', log, root]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/1 new type error\(s\) in scripts\/\*\*/);
    expect(res.stderr).toContain('scripts/b.ts(7): TS2304');
  });

  it('a fix that thinned the floor without a re-cut is red too', () => {
    const { root, log } = fixture([{ file: 'scripts/a.ts', code: 'TS2322', message: 'known', count: 2 }], '');
    const res = cli(['--from-file', log, root]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/baselined type error\(s\) thinned out/);
  });

  it('quotes a transcript it cannot parse rather than passing it', () => {
    const { root, log } = fixture([], 'error TS5111: a diagnostic this screen has no shape for\n');
    const res = cli(['--from-file', log, root]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/cannot parse/);
  });

  it('refuses to guard a tree with no typecheck project', () => {
    const root = mkdtempSync(join(tmpdir(), 'scripts-ts-nocfg-'));
    const res = cli([root]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/tsconfig\.scripts\.json is missing/);
  });
});
