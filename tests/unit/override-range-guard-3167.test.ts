/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The #3167 override-range guard.
 *
 * A top-level npm `override` does not intersect with a parent's declared range —
 * it replaces that range for every copy in the tree, and npm then reports the
 * resulting tree as healthy. `npm install` succeeds, `npm ls` prints nothing,
 * and the mismatch only shows up at call time:
 *
 *   "brace-expansion": "^2.1.4" forced 2.1.7 onto minimatch@10.2.6 (wants ^5.0.8),
 *   and minimatch@10 calls the named `expand` export that only exists in 5.x.
 *   Every brace pattern on the glob@13 path threw
 *   `TypeError: (0 , brace_expansion_1.expand) is not a function`.
 *
 * So the guard is tested against planted lockfiles in both directions: the
 * blanket shape must be named, and the version-scoped shape that fixes it must
 * not be flagged — otherwise the next maintainer deletes the guard as noise.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  overriddenNames,
  resolveChild,
  checkOverrideRanges,
  runGuard,
} from '../../scripts/check-override-ranges.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

type LockPackages = Record<string, { version: string; dependencies?: Record<string, string> }>;
type Violation = { parent: string; name: string; range: string; got: string; edge: string };

// Lockfile shape: npm's package-lock v3 `packages` map.
const lock = (packages: LockPackages): LockPackages => packages;

describe('checkOverrideRanges — the bug that shipped', () => {
  it('names a blanket override that forces a cross-major onto a consumer', () => {
    const pkgs = lock({
      'node_modules/glob': { version: '13.0.6', dependencies: { minimatch: '^10.0.0' } },
      'node_modules/glob/node_modules/minimatch': {
        version: '10.2.6',
        dependencies: { 'brace-expansion': '^5.0.8' },
      },
      // hoisted, and the only copy — because the override pinned it there
      'node_modules/brace-expansion': { version: '2.1.7' },
    });
    const overrides = { 'brace-expansion': '^2.1.4' };

    const { edges, violations } = checkOverrideRanges(pkgs, overrides);

    expect(edges).toBe(1);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      parent: 'glob/node_modules/minimatch',
      name: 'brace-expansion',
      range: '^5.0.8',
      got: '2.1.7',
    });
  });

  it('catches the second victim on the same edge set (different major, same override)', () => {
    const pkgs = lock({
      'node_modules/minimatch': { version: '3.1.5', dependencies: { 'brace-expansion': '^1.1.7' } },
      'node_modules/brace-expansion': { version: '2.1.7' },
    });
    const { violations } = checkOverrideRanges(pkgs, { 'brace-expansion': '^2.1.4' });
    expect(violations.map((v: Violation) => v.edge)).toEqual(['minimatch -> brace-expansion']);
  });
});

describe('checkOverrideRanges — the fix must not be flagged', () => {
  it('accepts a version-scoped override where each line gets its own major', () => {
    const pkgs = lock({
      'node_modules/glob': { version: '13.0.6', dependencies: { minimatch: '^10.0.0' } },
      'node_modules/glob/node_modules/minimatch': {
        version: '10.2.6',
        dependencies: { 'brace-expansion': '^5.0.8' },
      },
      'node_modules/glob/node_modules/brace-expansion': { version: '5.0.12' },
      'node_modules/minimatch': { version: '3.1.5', dependencies: { 'brace-expansion': '^1.1.7' } },
      'node_modules/minimatch/node_modules/brace-expansion': { version: '1.1.21' },
      'node_modules/readdir-glob/node_modules/minimatch': {
        version: '5.1.9',
        dependencies: { 'brace-expansion': '^2.0.1' },
      },
      'node_modules/readdir-glob/node_modules/brace-expansion': { version: '2.1.7' },
    });

    const { edges, violations } = checkOverrideRanges(pkgs, {
      'minimatch@10': { 'brace-expansion': '^5.0.12' },
    });

    expect(edges).toBe(3);
    expect(violations).toEqual([]);
  });

  it('does not invent violations for packages no override touches', () => {
    const pkgs = lock({
      'node_modules/foo': { version: '1.0.0', dependencies: { bar: '^2.0.0' } },
      'node_modules/bar': { version: '9.9.9' },
    });
    expect(checkOverrideRanges(pkgs, { 'brace-expansion': '^5.0.12' }).edges).toBe(0);
  });
});

describe('override name extraction and npm resolution', () => {
  it('covers blanket, nested, version-scoped and "." keys', () => {
    const names = overriddenNames({
      ws: '^8.21.0',
      'minimatch@10': { 'brace-expansion': '^5.0.12' },
      exceljs: { uuid: '^11.1.1' },
      vite: { '.': '~8.2.4', rollup: '^4.0.0' },
    });
    expect([...names].sort()).toEqual(['brace-expansion', 'rollup', 'uuid', 'vite', 'ws']);
  });

  it('prefers the nearest nested copy, then walks up to the root', () => {
    const pkgs = lock({
      'node_modules/a/node_modules/b': { version: '1.0.0' },
      'node_modules/a': { version: '1.0.0', dependencies: { b: '^1.0.0' } },
      'node_modules/c': { version: '1.0.0', dependencies: { b: '^1.0.0' } },
      'node_modules/b': { version: '2.0.0' },
    });
    expect(resolveChild(pkgs, 'node_modules/a', 'b')).toBe('node_modules/a/node_modules/b');
    expect(resolveChild(pkgs, 'node_modules/c', 'b')).toBe('node_modules/b');
    expect(resolveChild(pkgs, 'node_modules/b', 'absent')).toBeNull();
  });

  it('survives a range npm itself cannot parse instead of throwing', () => {
    const pkgs = lock({
      'node_modules/x': { version: '1.0.0', dependencies: { ws: 'github:websockets/ws' } },
      'node_modules/ws': { version: '8.21.3' },
    });
    expect(() => checkOverrideRanges(pkgs, { ws: '^8.21.0' })).not.toThrow();
    expect(checkOverrideRanges(pkgs, { ws: '^8.21.0' }).violations).toEqual([]);
  });
});

describe('the repo tree itself', () => {
  const lock = JSON.parse(readFileSync(`${ROOT}package-lock.json`, 'utf8'));
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
  const { violations } = checkOverrideRanges(lock.packages, pkg.overrides);

  it('ships no override edge that forces a brace-expansion cross-major', () => {
    // The #3167 regression, asserted directly rather than via counts.
    const brace = violations.filter((v: Violation) => v.name === 'brace-expansion');
    expect(brace).toEqual([]);
  });

  it('passes the guard with its committed baseline', () => {
    const result = runGuard({ root: ROOT, quiet: true });
    expect(result.ok).toBe(true);
    expect(result.unexpected).toEqual([]);
  });

  it('reports the baseline entries it is actually accepting', () => {
    const accepted = JSON.parse(
      readFileSync(`${ROOT}scripts/override-range-baseline.json`, 'utf8'),
    ).entries.map((e: { parent: string; name: string }) => `${e.parent} -> ${e.name}`);
    const violating = violations.map((v: { edge: string }) => v.edge).sort();

    // Every violation must be baselined, and every baseline entry must still be
    // a real violation — a stale "we approved this" line is how an accepted
    // cross-major outlives the reason it was accepted.
    expect(violating).toEqual([...accepted].sort());
  });
});
