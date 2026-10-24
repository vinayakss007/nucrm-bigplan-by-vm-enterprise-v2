/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Override-range guard (#3167).
 *
 * npm `overrides` do not intersect with a parent's declared range — a top-level
 * entry REPLACES it, for every copy of that package in the tree. npm then
 * installs the highest version satisfying the override and reports the tree as
 * healthy. `npm install` succeeds, `npm ls` prints nothing, and the mismatch
 * only surfaces at call time.
 *
 * That is not hypothetical: `"brace-expansion": "^2.1.4"` forced `2.1.7` onto
 * `minimatch@10.2.6`, which calls the named `expand` export that only exists in
 * brace-expansion 5.x — every brace pattern on the glob@13 path threw
 * `TypeError: (0 , brace_expansion_1.expand) is not a function`.
 *
 * This guard checks, for every package named in `overrides`, each parent->child
 * edge in package-lock.json against the range that parent actually declared.
 * Out-of-range edges need an entry in scripts/override-range-baseline.json.
 *
 * Scope is deliberately the override surface only. Tree-wide there are other
 * out-of-range edges (unsatisfied optional/peer resolutions inside @sentry,
 * `latest` specifiers); they are npm's own doing, not a pin we authored, and
 * including them would put the guard permanently in the red — which is how
 * guards stop being read.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Names an `overrides` block can touch, including nested and version-scoped keys. */
export function overriddenNames(overrides) {
  const names = new Set();
  const walk = (obj) => {
    for (const [key, value] of Object.entries(obj)) {
      const bare = key.split('@')[0];
      if (typeof value === 'string') {
        names.add(bare);
      } else if (value && typeof value === 'object') {
        if (value['.']) names.add(bare);
        for (const [inner, innerValue] of Object.entries(value)) {
          // "." is the self-spec of the parent above, not a package name.
          if (inner === '.') continue;
          if (typeof innerValue === 'string') names.add(inner.split('@')[0]);
          else if (innerValue && typeof innerValue === 'object') walk(innerValue);
        }
      }
    }
  };
  walk(overrides || {});
  return names;
}

/** Resolve a child the way npm would: nearest nested copy, else walk up, else root. */
export function resolveChild(pkgs, parentKey, name) {
  let dir = parentKey;
  for (;;) {
    const candidate = posix.join(dir, 'node_modules', name);
    if (pkgs[candidate]) return candidate;
    const up = dir.replace(/\/node_modules\/[^/]+$/, '');
    if (up === dir) break;
    dir = up;
  }
  return pkgs['node_modules/' + name] ? 'node_modules/' + name : null;
}

/**
 * @returns {{edges: number, violations: Array<{parent, name, range, got, edge}>, checkedNames: string[]}}
 */
export function checkOverrideRanges(pkgs, overrides) {
  const names = overriddenNames(overrides);
  const violations = [];
  let edges = 0;

  for (const [key, entry] of Object.entries(pkgs)) {
    if (!key.startsWith('node_modules/')) continue;
    for (const [name, range] of Object.entries(entry.dependencies || {})) {
      if (!names.has(name)) continue;
      const childKey = resolveChild(pkgs, key, name);
      if (!childKey) continue;
      const got = pkgs[childKey].version;
      // Non-registry specifiers (git URLs, dist-tags like "latest", npm: aliases)
      // are ranges semver cannot represent. semver.satisfies answers false for
      // them rather than throwing, so they must be skipped explicitly — a guard
      // that reports them as violations is reporting noise.
      if (semver.validRange(range, { includePrerelease: true }) === null) continue;
      edges += 1;
      let ok = true;
      try {
        ok = semver.satisfies(got, range, { includePrerelease: true });
      } catch {
        ok = true;
      }
      if (!ok) {
        violations.push({
          parent: key.replace(/^node_modules\//, ''),
          name,
          range,
          got,
          edge: `${key.replace(/^node_modules\//, '')} -> ${name}`,
        });
      }
    }
  }

  return { edges, violations, checkedNames: [...names].sort() };
}

export function runGuard({ root = ROOT, quiet = false } = {}) {
  const pkgPath = join(root, 'package.json');
  const lockPath = join(root, 'package-lock.json');
  const baselinePath = join(root, 'scripts', 'override-range-baseline.json');

  if (!existsSync(lockPath)) {
    if (!quiet) console.error('override-range guard: package-lock.json is missing.');
    return { ok: false, reason: 'missing-lock', edges: 0, violations: [], stale: [] };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const baseline = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : { entries: [] };

  const { edges, violations, checkedNames } = checkOverrideRanges(lock.packages || {}, pkg.overrides);
  const accepted = new Set((baseline.entries || []).map((e) => `${e.parent} -> ${e.name}`));

  const unexpected = violations.filter((v) => !accepted.has(v.edge));
  const stale = (baseline.entries || [])
    .map((e) => `${e.parent} -> ${e.name}`)
    .filter((edge) => !violations.some((v) => v.edge === edge));

  if (!quiet) {
    console.log(`override-range guard: ${checkedNames.length} overridden packages, ${edges} parent->child edges checked.`);
    if (violations.length === 0) {
      console.log('OK: every override resolves inside the range its parent declares.');
    } else {
      for (const v of violations) {
        const tag = accepted.has(v.edge) ? 'baselined' : 'UNEXPECTED';
        console.log(`  [${tag}] ${v.edge}: parent wants ${v.range}, got ${v.got}`);
      }
    }
    if (stale.length) {
      console.log(`\n${stale.length} baseline entry/entries no longer violate anything — prune them:`);
      stale.forEach((s) => console.log(`  ${s}`));
    }
    if (unexpected.length) {
      console.error(
        `\nFAIL: ${unexpected.length} override edge(s) install a version outside the parent's declared range.\n` +
          'A top-level override REPLACES that range for every copy in the tree, so this is how a\n' +
          'silent cross-major ships. Fix it by scoping the override to the line that needs it, e.g.\n' +
          '  "overrides": { "minimatch@10": { "brace-expansion": "^5.0.12" } }\n' +
          'If the forcing is intentional, add the edge to scripts/override-range-baseline.json with a reason.',
      );
    } else {
      console.log('\nOK: no un-baselined override range violations.');
    }
  }

  return { ok: unexpected.length === 0, edges, violations, unexpected, stale };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(runGuard().ok ? 0 : 1);
}
