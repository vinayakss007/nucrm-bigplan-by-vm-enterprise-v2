import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*!
 * An unversioned build must say "unknown", not "1.0.0".
 *
 * `npm_package_version` is not a normal environment variable: npm only exports
 * it into the child environment of a *lifecycle script*. The app container is
 * launched by `npm run prod:start:custom`, so it gets the value, but every
 * other entry point — `node server.js` from a standalone build, `node --import
 * tsx worker.ts`, a runbook one-liner, a locally patched image — leaves it
 * unset. All three self-reporting sites then fell back to the literal
 * `'1.0.0'`, a release `package.json` has never carried. The result was twice
 * destructive: `/api/health` claimed a version that does not exist, and Sentry
 * tagged those events with it, so the "which build broke?" question had a
 * permanently wrong answer — and the day 1.0.0 really ships, an unversioned
 * mis-build becomes indistinguishable from the release itself.
 *
 * Two things shape this test:
 *
 * 1. It is a source scan, not a runtime test. Nothing at runtime would notice a
 *    wrong version tag; that is precisely why the defect survived. `Secret Scan`
 *    keys on credentials and `Launch Gate` on liveness, so no existing check
 *    reads a version string.
 * 2. The rule is about *concreteness*, not about one value. A fallback may be
 *    `'unknown'`, `undefined`, or another env lookup; it may not be a version
 *    number, because a version number asserts a build identity the process does
 *    not have.
 */

const VERSION_ENV = 'npm_package_version';

/** `'1.0.0'`, `"2.3"`, `0.9.0-rc.1` — anything that reads as a release identity. */
const SEMVER_LIKE = /^\d+(\.\d+){1,2}(?:[-+][0-9A-Za-z.+-]+)?$/;

/** The literal that follows the env read: `… || 'x'`, `… ?? "x"`, `` … || `x` ``. */
const TAIL_FALLBACK = /(?:\|\||\?\?)\s*(['"`])([^'"`]*)\1/;

export interface FallbackSite {
  file: string;
  line: number;
  value: string;
}

/**
 * Prose is allowed to quote the line this guard exists to remove — the 1.0.0
 * scope document describes the defect verbatim. Only code that *evaluates* the
 * expression counts as a site.
 */
const isCommentLead = (line: string): boolean => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
};

export function versionFallbacks(source: string, file = '<inline>'): FallbackSite[] {
  const found: FallbackSite[] = [];
  source.split('\n').forEach((line, idx) => {
    if (!line.includes(VERSION_ENV) || isCommentLead(line)) return;
    const tail = line.slice(line.lastIndexOf(VERSION_ENV) + VERSION_ENV.length);
    const match = tail.match(TAIL_FALLBACK);
    if (match) found.push({ file, line: idx + 1, value: match[2] as string });
  });
  return found;
}

export const isLie = (site: FallbackSite): boolean => SEMVER_LIKE.test(site.value);

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', 'out', '.qoder', 'test-results', 'playwright-report']);
const RUNTIME_EXT = /\.(ts|tsx|mjs|cjs|mts|js|jsx)$/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (RUNTIME_EXT.test(name)) out.push(p);
  }
  return out;
};

/**
 * `tests/` is out for the reason every scan here has the same reason: fixtures
 * must be free to plant the bad shape, including in this very file. `.agents/`
 * is out because it holds generated task notes that quote historic code.
 */
const UNPOLICED_PREFIXES = ['tests/', '.agents/'];

const runtimeSources = (): string[] =>
  walk('.').filter((f) => !UNPOLICED_PREFIXES.some((p) => f.startsWith(p)));

const sitesInTree = (): FallbackSite[] =>
  runtimeSources().flatMap((file) => versionFallbacks(readFileSync(file, 'utf8'), file));

describe('self-reported app version cannot be invented', () => {
  it('names a planted version-shaped fallback (control)', () => {
    const sites = versionFallbacks(
      [
        "  service: 'nucrm-app',",
        "  version: process.env['npm_package_version'] || '1.0.0',",
      ].join('\n'),
      'sentry.server.config.ts',
    );
    expect(sites).toEqual([{ file: 'sentry.server.config.ts', line: 2, value: '1.0.0' }]);
    expect(sites.map(isLie)).toEqual([true]);
  });

  it('reads every fallback shape the tree actually uses (control)', () => {
    expect(versionFallbacks("const v = process.env.npm_package_version ?? '0.9.0';")).toEqual([
      { file: '<inline>', line: 1, value: '0.9.0' },
    ]);
    expect(versionFallbacks('  version: process.env[\'npm_package_version\'] || `2.0.0-rc.1`,')).toHaveLength(1);
    // Two statements on one line: the fallback still belongs to the env read.
    expect(versionFallbacks("a(); process.env['npm_package_version'] || '3.4.5';")).toHaveLength(1);
  });

  it('leaves honest fallbacks alone (control)', () => {
    const knownGood = [
      "version: process.env['npm_package_version'] || 'unknown',",
      "release: process.env['npm_package_version'] || undefined,",
      "version: process.env['npm_package_version'] || process.env['APP_VERSION'],",
      "version: process.env['npm_package_version'],",
      "if (process.env['npm_package_version']) snapshot(process.env['npm_package_version']);",
      "const label = 'build ' + (process.env['npm_package_version'] || 'source-checkout');",
    ];
    for (const line of knownGood) {
      const sites = versionFallbacks(line);
      expect(sites.filter(isLie)).toEqual([]);
    }
  });

  it('does not treat prose as a site (control)', () => {
    const quoted = [
      "// the old '1.0.0' default: process.env['npm_package_version'] || '1.0.0'",
      ' * process.env[\'npm_package_version\'] || \'1.0.0\' is what the register quotes',
    ];
    for (const line of quoted) expect(versionFallbacks(line)).toEqual([]);
  });

  it('distinguishes a version from a status word (control)', () => {
    expect(SEMVER_LIKE.test('1.0.0')).toBe(true);
    expect(SEMVER_LIKE.test('0.9')).toBe(true);
    expect(SEMVER_LIKE.test('1.2.3-rc.1')).toBe(true);
    expect(SEMVER_LIKE.test('unknown')).toBe(false);
    expect(SEMVER_LIKE.test('source-checkout')).toBe(false);
  });

  it('floors the scan so silence cannot pass as compliance', () => {
    const sites = sitesInTree();
    // Without this, a walk that found no files, or a rewrite that dropped the
    // env read everywhere at once, would satisfy the assertions below for free.
    expect(sites.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThanOrEqual(2);
  });

  it('has no invented version anywhere in the runtime tree', () => {
    const lies = sitesInTree().filter(isLie);
    expect(lies.map((s) => `${s.file}:${s.line} → '${s.value}'`)).toEqual([]);
  });

  it('every self-reporting site falls back to "unknown"', () => {
    const sites = sitesInTree();
    const byFile = new Map(sites.map((s) => [s.file, s.value]));
    for (const file of ['app/api/health/route.ts', 'sentry.client.config.ts', 'sentry.server.config.ts']) {
      expect(byFile.get(file), file).toBe('unknown');
    }
    // Nothing else may claim a concrete release either.
    expect(new Set(sites.map((s) => s.value))).toEqual(new Set(['unknown']));
  });

  it('proves the old default never matched this app', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(SEMVER_LIKE.test(pkg.version)).toBe(true);
    // The fallback said 1.0.0 while the package said something else; if these
    // ever agree, the fallback is still wrong — it just becomes harder to see.
    expect(pkg.version).not.toBe('1.0.0');
  });
});
