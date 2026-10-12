import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*!
 * #1341 / #1268 / #1269 — the `any` gate.
 *
 * The three issues counted 156, 271 and 1686+ suppressions. Measured across
 * everything eslint actually lints, the tree now holds 52 across 21 files —
 * all grandfathered into `scripts/any-suppression-baseline.json` — and the
 * checks below are what keep them from coming back. Two things have to stay
 * true:
 *
 * 1. `@typescript-eslint/no-explicit-any` is `error`. At `warn` the rule was
 *    decorative: `npm run lint` is plain `eslint .`, with no `--max-warnings`,
 *    so a new `any` written *without* a disable comment — which is how people
 *    avoid the ratchet — passed CI silently. Five such sites existed the moment
 *    this was measured, and they are exactly the ones the suppression count
 *    never saw.
 * 2. The ratchet looks at the whole linted tree. Its root list used to be
 *    `app, lib, components, hooks, workers` — `workers` does not exist, and the
 *    suppressions in `drizzle/`, `types/`, `tests/`, `scripts/` and the
 *    root-level sources were invisible to it, so those files could grow while
 *    the guard reported "1 suppression".
 *
 * A source scan because neither property is observable at runtime, and both are
 * one careless config edit away from being undone.
 */

const SUPPRESSION = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-any/g;

/** Top-level directories eslint ignores outright (eslint.config.mjs `ignores`). */
const LINT_IGNORED = new Set([
  'node_modules', '.next', '.next-build', 'out', 'coverage', 'storybook-static',
  'playwright-report', 'test-results', 'public', 'archive', 'logs',
]);

const isSource = (name: string): boolean =>
  /\.(ts|tsx)$/.test(name) &&
  !/\.(test|spec)\.(ts|tsx)$/.test(name) &&
  !/\.stories\.tsx$/.test(name) &&
  name !== 'next-env.d.ts';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || LINT_IGNORED.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (isSource(name)) out.push(p);
  }
  return out;
};

/** The eslint rule's configured severity, read from the flat config. */
const ruleSeverity = (): string => {
  const config = readFileSync('eslint.config.mjs', 'utf8');
  const m = /"@typescript-eslint\/no-explicit-any"\s*:\s*"([a-z]+)"/.exec(config);
  expect(m, 'no-explicit-any must be configured in eslint.config.mjs').not.toBeNull();
  return m![1] as string;
};

/** The directories the suppression ratchet scans, read from its source. */
const ratchetRoots = (): string[] => {
  const script = readFileSync('scripts/check-any-suppressions.mjs', 'utf8');
  const m = /const ROOTS = \[([^\]]*)\]/.exec(script);
  expect(m, 'check-any-suppressions.mjs must declare ROOTS').not.toBeNull();
  return [...(m![1] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
};

describe('#1341 the no-explicit-any rule is enforced, not suggested', () => {
  it('is configured as an error', () => {
    // `warn` reads as strictness without failing anything; see the header.
    expect(ruleSeverity()).toBe('error');
  });

  it('is not relaxed again for tests or scripts', () => {
    // The ratchet counts those directories now, so a per-file rule override
    // there would turn the gate off exactly where 51 of the 52 current
    // suppressions — and every future one — live.
    const config = readFileSync('eslint.config.mjs', 'utf8');
    const relaxations = [...config.matchAll(/files:\s*\[[^\]]*\][^}]*\}/gs)]
      .map((m) => m[0])
      .filter((block) => /no-explicit-any/.test(block));
    expect(relaxations).toEqual([]);
  });
});

describe('#1268 the suppression ratchet sees the whole linted tree', () => {
  it('grandfatheres every suppression that actually exists', () => {
    const baseline = JSON.parse(readFileSync('scripts/any-suppression-baseline.json', 'utf8')) as Record<string, number>;
    const unrecorded = [];
    const underRecorded = [];
    for (const file of walk('.')) {
      const n = (readFileSync(file, 'utf8').match(SUPPRESSION) || []).length;
      if (n === 0) continue;
      if (baseline[file] === undefined) unrecorded.push(`${file} (${n})`);
      else if (baseline[file] < n) underRecorded.push(`${file} (${n} > baseline ${baseline[file]})`);
    }
    // A file the guard does not read is a file whose count can grow silently —
    // the hole that hid 14 of the 52 current entries in drizzle/, types/,
    // tests/, scripts/ and the root-level worker/Sentry sources.
    expect(unrecorded).toEqual([]);
    expect(underRecorded).toEqual([]);
  });

  it('records nothing that the tree no longer has', () => {
    // Stale baseline entries make the ceiling higher than reality, so a file
    // can regain a suppression it was supposed to have shed.
    const baseline = JSON.parse(readFileSync('scripts/any-suppression-baseline.json', 'utf8')) as Record<string, number>;
    const counts = new Map(walk('.').map((f) => [f, (readFileSync(f, 'utf8').match(SUPPRESSION) || []).length]));
    const stale = Object.keys(baseline).filter((f) => (counts.get(f) ?? 0) === 0);
    expect(stale).toEqual([]);
  });

  it('scans directories that still exist', () => {
    // A stale root is a root that quietly stops covering anything.
    const missing = ratchetRoots().filter((dir) => !existsSync(dir));
    expect(missing).toEqual([]);
  });
});
