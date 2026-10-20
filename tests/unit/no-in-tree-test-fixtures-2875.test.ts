import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*!
 * No test may plant a fixture in this working tree (#2875).
 *
 * Two of them did, and CI paid for it: `counter-increments-atomic.test.ts` wrote
 * `app/api/__counter-ratchet-probe__/route.ts` and `csv-formula-injection.test.ts`
 * wrote `app/__csv_guard_probe__/page.tsx`, both deleted again the moment the test
 * finished. Vitest runs test files in parallel, and 29 of them walk this same tree
 * with a directory listing first and a read second — a pair that is not atomic. The
 * planter's teardown landed inside another file's scan and that file died on:
 *
 *   Error: ENOENT: no such file or directory, open 'app/api/__counter-ratchet-probe__/route.ts'
 *     at tests/unit/app-version-fallback-guard.test.ts:93  (runtimeSources → readFileSync)
 *
 * The tree was never unstable; the scanner is. Hardening 39 readers to tolerate a
 * file vanishing mid-walk would only mean the next planted fixture breaks something
 * quieter — and 10 of the guards under `scripts/` scan under `app/` themselves, so a
 * fixture that offended its own guard could also flip an unrelated verdict.
 *
 * So the rule sits on the writer. A guard-under-test gets its own root: both guards
 * read `process.cwd()` for everything (root, scan dir, and the path they print), so
 * `execFileSync('node', [GUARD], { cwd: mkdtempSync(...) })` tests the real script
 * against a tree nobody else is looking at.
 */

/**
 * Expressions that name this working tree, however the file builds them — including
 * from `import.meta.url`, which is how `REPO` itself is defined in most of these files.
 */
const REPO_ROOT_EXPR =
  /\bREPO(_ROOT)?\b|\brepoRoot\b|\b__dirname\b|process\.cwd\(\)|import\.meta\.(?:url|dirname)/;

/** Only path-building expressions make a name a *location*; `const rows = read(MIGRATIONS_DIR)` does not. */
const PATH_EXPR = /\b(?:join|resolve)\s*\(/;

/** Calls that would put a file into, or take one out of, the tree. */
const WRITE_CALL =
  /\b(writeFileSync|appendFileSync|copyFileSync|mkdirSync|createWriteStream|symlinkSync|renameSync|unlinkSync|rmdirSync|rmSync)\s*\(/g;

export interface Plant {
  file: string;
  line: number;
  call: string;
  via: string;
}

/** The first argument of the call that opens at `open` — balanced, quote-aware. */
function firstArg(source: string, open: number): string {
  let depth = 0;
  let quote = '';
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    } else if (ch === ',' && depth === 1) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

const lineOf = (source: string, idx: number): number => source.slice(0, idx).split('\n').length;

/**
 * Prose and fixtures-as-strings describe the forbidden shape without performing it —
 * this very file quotes `mkdirSync(join(REPO, …))` in its controls. Blank the inside of
 * comments and of literals that interpolate nothing, keeping every byte position (and
 * every parenthesis and quote) where it was, so the scan that follows only sees calls
 * the file actually makes. One pass, because the two are only separable by state:
 * `// don't do this` is a comment, and `'https://x'` is not a comment start.
 */
function withoutProse(source: string): string {
  const out = source.split('');
  const blankAt = (i: number): void => {
    if (out[i] !== '\n') out[i] = ' ';
  };
  type State = 'code' | 'line' | 'block' | string;
  let state: State = 'code';
  let templateInterpolates = false;
  // a `/` only opens a regex where a value cannot end — otherwise `/\s*(['"])…/`
  // would read as a string and derail every quote after it
  let lastValue = '';
  const skipRegex = (i: number): number | null => {
    if (source[i] !== '/' || /[A-Za-z0-9_$)\]]/.test(lastValue)) return null;
    let inClass = false;
    for (let j = i + 1; j < source.length; j++) {
      const c = source[j];
      if (c === '\n') return null;
      if (c === '\\') j++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) return j;
    }
    return null;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line') {
      if (ch === '\n') state = 'code';
      else blankAt(i);
    } else if (state === 'block') {
      blankAt(i);
      if (ch === '*' && next === '/') {
        blankAt(i + 1);
        i++;
        state = 'code';
      }
    } else if (state === 'code') {
      const regexEnd = skipRegex(i);
      if (ch === '/' && next === '/' && regexEnd === null) {
        blankAt(i);
        blankAt(i + 1);
        i++;
        state = 'line';
      } else if (ch === '/' && next === '*' && regexEnd === null) {
        blankAt(i);
        blankAt(i + 1);
        i++;
        state = 'block';
      } else if (regexEnd !== null) {
        i = regexEnd;
        lastValue = '/';
      } else if (ch === '"' || ch === "'" || ch === '`') {
        state = ch;
        templateInterpolates = false;
      } else if (!/\s/.test(ch)) {
        lastValue = ch;
      }
    } else {
      // inside a string: blank it, but leave `${…}` visible — a template that
      // interpolates REPO is a path the writer really builds
      if (ch === '\\') {
        blankAt(i);
        blankAt(i + 1);
        i++;
      } else if (ch === state) {
        state = 'code';
        lastValue = ch;
      } else {
        if (ch === '$' && next === '{') templateInterpolates = true;
        if (!(state === '`' && templateInterpolates)) blankAt(i);
      }
    }
  }
  return out.join('');
}

/**
 * A write whose target is this tree, directly (`join(REPO, 'app', …)`) or through a
 * constant that was defined from it (`const PROBE = join(REPO, …)`).
 */
export function plants(source: string, file = '<inline>'): Plant[] {
  const code = withoutProse(source);

  // `const NAME = …this tree…` — a fixture is almost always built once and reused,
  // and reused *through* another constant (`PROBE` under `PROBE_DIR` under `SCRATCH`),
  // so the names are collected until no new one appears.
  const bindings = [...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)].map(
    (m) => [m[1]!, m[2]!] as const,
  );
  const repoRootNames = new Set<string>();
  for (let pass = 0; pass < bindings.length; pass++) {
    const before = repoRootNames.size;
    for (const [name, expr] of bindings) {
      if (repoRootNames.has(name) || !PATH_EXPR.test(expr)) continue;
      const rooted =
        REPO_ROOT_EXPR.test(expr) || [...repoRootNames].some((n) => new RegExp(`\\b${n}\\b`).test(expr));
      if (rooted) repoRootNames.add(name);
    }
    if (repoRootNames.size === before) break;
  }

  const found: Plant[] = [];
  for (const m of code.matchAll(WRITE_CALL)) {
    const open = (m.index as number) + (m[0] as string).length - 1;
    const at = firstArg(code, open);
    const named = [...repoRootNames].filter((name) => new RegExp(`\\b${name}\\b`).test(at));
    // an unrooted literal (`writeFileSync('app/x.ts')`) resolves against the repo too
    const relativeLiteral = /^\s*(['"])(?![/.~])[^'"]*\1\s*$/.test(at);
    const via = REPO_ROOT_EXPR.test(at)
      ? 'names the repo root'
      : named.length > 0
        ? `built from ${named.join('/')}`
        : relativeLiteral
          ? 'a path relative to the runner cwd'
          : '';
    if (!via) continue;
    // masking keeps every position, so the report can quote the file's real text
    found.push({
      file,
      line: lineOf(source, m.index as number),
      call: `${m[1]}(${firstArg(source, open).trim().slice(0, 60)})`,
      via,
    });
  }
  return found;
}

const testSources = (dir = 'tests', out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) testSources(p, out);
    else if (/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
};

describe('test fixtures stay out of the working tree (#2875)', () => {
  it('catches a fixture written straight into the repo (control)', () => {
    const found = plants(`
      mkdirSync(join(REPO, 'app', '__probe__'), { recursive: true });
      writeFileSync(join(REPO, 'app', '__probe__', 'page.tsx'), 'x');
    `);
    expect(found.map((p) => p.call)).toEqual([
      "mkdirSync(join(REPO, 'app', '__probe__'))",
      "writeFileSync(join(REPO, 'app', '__probe__', 'page.tsx'))",
    ]);
  });

  it('catches one written through a constant defined from the repo root (control)', () => {
    const found = plants(`
      const PROBE_DIR = join(REPO, 'app', 'api', '__probe__');
      const PROBE = join(PROBE_DIR, 'route.ts');
      mkdirSync(PROBE_DIR, { recursive: true });
      writeFileSync(PROBE, 'x');
    `);
    expect(found.map((p) => p.line)).toEqual([4, 5]);
  });

  it('leaves a scratch-tree fixture alone (control)', () => {
    expect(
      plants(`
        const SCRATCH = mkdtempSync(join(tmpdir(), 'counter-ratchet-'));
        const PROBE = join(SCRATCH, 'app', 'api', '__probe__', 'route.ts');
        mkdirSync(dirname(PROBE), { recursive: true });
        writeFileSync(PROBE, 'x');
        afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
      `),
    ).toEqual([]);
  });

  it('does not care about reads, which are the whole point of a source scan (control)', () => {
    expect(plants(`const src = readFileSync(join(REPO, 'lib', 'csv.ts'), 'utf8');`)).toEqual([]);
  });

  it('no test file in this tree plants a fixture in it', () => {
    const offenders = testSources().flatMap((file) => plants(readFileSync(file, 'utf8'), file));
    expect(
      offenders.map((o) => `${o.file}:${o.line} ${o.call} — ${o.via}`),
      'a fixture in the live tree is deleted under whichever test happens to be scanning it',
    ).toEqual([]);
  });

  it('the screen over tests/ is not looking at nothing', () => {
    expect(
      testSources().length,
      'tests/ has no .test.ts files — the walk is broken, not the tree',
    ).toBeGreaterThan(300);
  });
});
