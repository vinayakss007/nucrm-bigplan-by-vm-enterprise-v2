/**
 * #3413 — `tsconfig.json` excludes `scripts/**`, so the ~60 operator scripts
 * that talk to the database were compiled by nothing. The blind spot was not
 * cosmetic: `restore-db.ts` imported `pgSslConfig` three times, and
 * `migrate.ts` called `groupMissingByOwner` — which is not imported — from the
 * FATAL path of the script an operator reaches for when a migration fails.
 * Both are plain compile errors that `tsc` rejects outright and CI could not
 * see.
 *
 * The fix is a second project (`tsconfig.scripts.json`) wired into the
 * `npm run typecheck` CI step, ratcheted by a floor
 * (`scripts/scripts-typecheck-baseline.json`) rather than a mass rewrite of
 * seed scripts nobody asked for. These tests pin the wiring, the floor's
 * arithmetic on fixtures, and — independently of tsc — the bug class itself.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const SCREEN = join(ROOT, 'scripts', 'check-scripts-typecheck.mjs');
const BASELINE = join(ROOT, 'scripts', 'scripts-typecheck-baseline.json');

const run = (args: string[]) => {
  try {
    const stdout = execFileSync(process.execPath, [SCREEN, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

const walkScripts = (dir = join(ROOT, 'scripts')): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkScripts(p));
    else if (/\.(ts|mts)$/.test(name)) out.push(p);
  }
  return out;
};

describe('#3413 the scripts project exists and CI reads it', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
  const scripts = JSON.parse(readFileSync(join(ROOT, 'tsconfig.scripts.json'), 'utf8'));

  it('the app project still excludes scripts — that exclusion is the premise', () => {
    expect(app.exclude).toContain('scripts/**');
  });

  it('the new project inherits the app compiler options and covers the whole directory', () => {
    expect(scripts.extends).toBe('./tsconfig.json');
    expect(scripts.include).toEqual(['scripts/**/*.ts', 'scripts/**/*.mts']);
    expect(JSON.stringify(scripts.exclude)).not.toContain('scripts');
    // The scripts are the only thing that changed; resolution must still work,
    // or every `@/lib/...` import in them reads as a missing module.
    expect(scripts.compilerOptions.paths['@/*']).toEqual(['./*']);
  });

  it('npm run typecheck runs the screen, so the ci.yml typecheck step covers scripts', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.typecheck).toContain('check-scripts-typecheck.mjs');
    // ci.yml runs `npm run typecheck` — no new guard alias, so #3399's census
    // arithmetic is untouched by this PR.
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/run: npm run typecheck/);
  });

  it('the tree passes today', () => {
    const r = run([]);
    expect(r.out).toContain('all at or under the floor');
    expect(r.status).toBe(0);
  }, 240_000);
});

describe('#3413 the floor is a ratchet, not a mute button', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vm3413-'));
  const baseline = (obj: Record<string, number>) => {
    const p = join(dir, `base-${Object.values(obj).join('_')}.json`);
    writeFileSync(p, JSON.stringify({ _comment: 'fixture', ...obj }));
    return p;
  };
  const report = (lines: string[], name: string) => {
    const p = join(dir, `${name}.txt`);
    writeFileSync(p, `${lines.join('\n')}\n`);
    return p;
  };
  const err = (file: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${file}(${i + 1},1): error TS2300: dup`);

  it('an error set exactly at the floor is green', () => {
    const r = run(['--report', report(err('scripts/a.ts', 2), 'at.txt'), '--baseline', baseline({ 'scripts/a.ts': 2 })]);
    expect(r.status).toBe(0);
  });

  it('a baselined file that grows past its number is red, and says which', () => {
    const r = run(['--report', report(err('scripts/a.ts', 3), 'grew.txt'), '--baseline', baseline({ 'scripts/a.ts': 2 })]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/scripts\/a\.ts \(3 > floor 2\)/);
  });

  it('a file with errors the floor never heard of is red', () => {
    const r = run(['--report', report([...err('scripts/a.ts', 1), ...err('scripts/b.ts', 1)], 'fresh.txt'), '--baseline', baseline({ 'scripts/a.ts': 2 })]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/scripts\/b\.ts \(1\)/);
  });

  it('a file that got cheaper prints the hint and does not fail — the floor only ratchets down', () => {
    const r = run(['--report', report(err('scripts/a.ts', 1), 'shrunk.txt'), '--baseline', baseline({ 'scripts/a.ts': 5 })]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/got cheaper/);
  });

  it('a clean compile is green', () => {
    const r = run(['--report', report([], 'clean.txt'), '--status', '0', '--baseline', baseline({})]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('0 script file(s)');
  });

  it('tsc failing with nothing attributable is red, not zero errors', () => {
    // A bad -p argument, a crash, a config that cannot be read: all of them
    // say "error TS5083" with no file prefix. Reading that as a clean compile
    // is the exact failure mode this issue is about.
    writeFileSync(join(dir, 'noop.txt'), 'error TS5083: Cannot read file tsconfig.scripts.json\n');
    const r = run(['--report', join(dir, 'noop.txt'), '--baseline', baseline({})]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/without a single file-level error/);
  });

  it('the shipped floor is only positive integers over files that still exist', () => {
    const raw = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const entries = Object.entries(raw).filter(([k]) => /\.(ts|mts|cts)$/.test(k));
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, n] of entries) {
      expect(Number.isInteger(n), `${file} floor ${n}`).toBe(true);
      expect(n as number).toBeGreaterThan(0);
      expect(statSync(join(ROOT, file), { throwIfNoEntry: false }), `floor entry for a file that is gone: ${file}`).toBeTruthy();
    }
    expect(typeof raw._comment).toBe('string');
  });
});

/**
 * The bug class, pinned without tsc so it cannot come back on a file that is
 * currently floored: comments are stripped first, because a comment naming an
 * import is not an import.
 */
describe('#3413 no script imports the same binding twice', () => {
  const NAMED = /^import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/;

  for (const file of walkScripts()) {
    const src = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const line of src.split('\n')) {
      const m = NAMED.exec(line);
      if (!m) continue;
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop()!.trim();
        if (!name) continue;
        if (seen.has(name) && seen.get(name) !== m[2]) dupes.push(`${name} (two modules)`);
        else if (seen.has(name)) dupes.push(`${name} from ${m[2]}`);
        seen.set(name, m[2]);
      }
    }
    it(`${file.replace(`${ROOT}/`, '')} has no duplicate named import`, () => {
      expect(dupes).toEqual([]);
    });
  }
});

describe('#3413 the three runtime errors the blind spot shipped', () => {
  it('migrate.ts imports the helper its FATAL path calls', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'migrate.ts'), 'utf8');
    expect(src).toMatch(/groupMissingByOwner/);
    const imported = /^import \{([^}]*)\} from '\.\/migrate-recovery'/m.exec(src);
    expect(imported, 'the ./migrate-recovery import must be findable').toBeTruthy();
    expect(imported![1]).toMatch(/\bgroupMissingByOwner\b/);
  });

  it('drift-check --json reads the comparison it just computed, not names that do not exist', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'drift-check.ts'), 'utf8');
    expect(src).toMatch(/columnsCompared: comparison\.columnsCompared/);
    expect(src).toMatch(/findings: comparison\.findings/);
    expect(src).not.toMatch(/^\s+findings: columnFindings,/m);
  });

  it('simulate-preprod-flows types the bootstrap result it reads', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'simulate-preprod-flows.ts'), 'utf8');
    expect(src).toMatch(/let boot: \{ user_id: string; tenant_id: string \} \| null/);
  });

  it('restore-db.ts, the file the issue names, imports pgSslConfig exactly once', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'restore-db.ts'), 'utf8');
    expect([...src.matchAll(/import \{ pgSslConfig \} from/g)].length).toBe(1);
  });
});
