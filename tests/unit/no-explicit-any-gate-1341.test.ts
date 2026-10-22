import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collect, isLintedSource } from '../../scripts/check-any-suppressions.mjs';

/*!
 * #1341 / #1268 / #1269 — the `any` gate.
 *
 * The three issues counted 156, 271 and 1686+ suppressions. Measured across
 * everything eslint actually lints, the tree holds 464 across 134 files — all
 * grandfathered into `scripts/any-suppression-baseline.json` — and the checks
 * below are what keep them from coming back. Three things have to stay true:
 *
 * 1. `@typescript-eslint/no-explicit-any` is `error`. At `warn` the rule was
 *    decorative: `npm run lint` is plain `eslint .`, with no `--max-warnings`,
 *    so a new `any` written *without* a disable comment — which is how people
 *    avoid the ratchet — passed CI silently.
 * 2. The ratchet looks at the whole linted tree. Its root list used to be
 *    `app, lib, components, hooks, workers` — `workers` does not exist — and
 *    even after #1341 widened it, `walk()` skipped every `*.test.ts(x)`, which
 *    is how #1268 stayed open: 438 of the 464 suppressions were outside the
 *    count the guard printed.
 * 3. The baseline matches the tree — nothing unrecorded, nothing stale.
 *
 * Scope here is derived from `eslint.config.mjs` itself, not copied from the
 * guard: the bug this file used to share with the guard was that both agreed
 * with each other and neither agreed with eslint.
 */

// `[y]` keeps the detector text from matching its own pattern: an unbroken
// `no-explicit-any` literal on this line would make this file count as one of
// the suppressions the ratchet grandfatheres.
const SUPPRESSION = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-an[y]/g;

/** The `ignores` array of the flat config, read from the file that declares it. */
const configIgnores = (): string[] => {
  const config = readFileSync('eslint.config.mjs', 'utf8');
  const block = /ignores:\s*\[([\s\S]*?)\]/.exec(config);
  expect(block, 'eslint.config.mjs must declare a global ignores array').not.toBeNull();
  return [...(block![1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
};

const isIgnored = (path: string, ignores: string[]): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return ignores.some((g) => {
    // Flat-config ignores are root-relative: `node_modules/` and `tests/load/`
    // prune a whole tree, `**/*.stories.tsx` matches by filename.
    if (g.endsWith('/')) return path.startsWith(g);
    if (g.startsWith('**/')) return name.endsWith(g.slice(3));
    return path === g;
  });
};

/** Every `.ts`/`.tsx` the linter reads, walked independently of the guard. */
const lintedSources = (dir = '.', ignores = configIgnores(), out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = dir === '.' ? name : join(dir, name);
    if (isIgnored(p + '/x', ignores)) continue;
    if (statSync(p).isDirectory()) lintedSources(p, ignores, out);
    else if (/\.(ts|tsx)$/.test(name) && !isIgnored(p, ignores)) out.push(p);
  }
  return out;
};

const countOf = (file: string): number =>
  (readFileSync(file, 'utf8').match(SUPPRESSION) || []).length;

/** The rule's configured severity, and the per-directory relaxations, from config. */
const ruleSeverity = (): string => {
  const config = readFileSync('eslint.config.mjs', 'utf8');
  const m = /"@typescript-eslint\/no-explicit-any"\s*:\s*"([a-z]+)"/.exec(config);
  expect(m, 'no-explicit-any must be configured in eslint.config.mjs').not.toBeNull();
  return m![1] as string;
};

describe('#1341 the no-explicit-any rule is enforced, not suggested', () => {
  it('is configured as an error', () => {
    // `warn` reads as strictness without failing anything; see the header.
    expect(ruleSeverity()).toBe('error');
  });

  it('is not relaxed again for tests or scripts', () => {
    // The ratchet counts those directories now, so a per-file rule override
    // there would turn the gate off exactly where 464 of the 464 current
    // suppressions — 438 in test files — and every future one live.
    const config = readFileSync('eslint.config.mjs', 'utf8');
    const relaxations = [...config.matchAll(/files:\s*\[[^\]]*\][^}]*\}/gs)]
      .map((m) => m[0])
      .filter((block) => /no-explicit-any/.test(block));
    expect(relaxations).toEqual([]);
  });
});

describe('#1268 the suppression ratchet sees the whole linted tree', () => {
  it('reaches the test files the linter reaches', () => {
    // The specific hole: `walk()` once dropped every `*.test.ts(x)` while ROOTS
    // claimed `tests`, so a test file could add suppressions freely.
    const testSources = lintedSources().filter((f) => /\.test\.(ts|tsx)$/.test(f));
    expect(testSources.length, 'no test file reached the ratchet').toBeGreaterThan(0);
    for (const f of testSources) {
      expect(isLintedSource(f), `${f} is linted but not governed`).toBe(true);
    }
  });

  it('governs exactly the files eslint lints, no more and no fewer', () => {
    const scoped = new Set(Object.keys(collect()));
    const missed = lintedSources().filter((f) => countOf(f) > 0 && !scoped.has(f));
    expect(missed, 'suppressions eslint fails on, invisible to the ratchet').toEqual([]);
  });

  it('grandfatheres every suppression that actually exists', () => {
    const baseline = JSON.parse(readFileSync('scripts/any-suppression-baseline.json', 'utf8')) as Record<string, number>;
    const unrecorded = [];
    const underRecorded = [];
    for (const [file, n] of Object.entries(collect())) {
      if (baseline[file] === undefined) unrecorded.push(`${file} (${n})`);
      else if (baseline[file] < n) underRecorded.push(`${file} (${n} > baseline ${baseline[file]})`);
    }
    // A file the guard does not read is a file whose count can grow silently.
    expect(unrecorded).toEqual([]);
    expect(underRecorded).toEqual([]);
  });

  it('records nothing that the tree no longer has', () => {
    // Stale baseline entries make the ceiling higher than reality, so a file
    // can regain a suppression it was supposed to have shed.
    const baseline = JSON.parse(readFileSync('scripts/any-suppression-baseline.json', 'utf8')) as Record<string, number>;
    const counts = new Map(lintedSources().map((f) => [f, countOf(f)]));
    const stale = Object.keys(baseline).filter((f) => (counts.get(f) ?? 0) === 0);
    expect(stale).toEqual([]);
  });

  it('does not govern a file the linter never reads', () => {
    // `tests/load/` and `drizzle/migrations/` are ignored outright; a
    // suppression there is inert text, and counting it would ask a reviewer to
    // justify a comment no tool ever applies.
    for (const file of Object.keys(collect())) {
      expect(isIgnored(file, configIgnores()), `${file} is eslint-ignored yet governed`).toBe(false);
    }
  });
});
