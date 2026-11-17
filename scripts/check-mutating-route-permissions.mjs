/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Mutating-route role-gate guard (#3402, the "guard that enforces" half).
 *
 * #3402 found 66 of 248 mutating handlers authenticated and tenant-scoped but
 * with no ROLE check, so `member` could do what `owner` does. The entity-by-entity
 * fixes are reviewable PRs; this screen is what stops the class from coming back
 * after they land. It is deliberately a *file-level* exact set, not a count:
 *
 *   - a mutating route (exports POST/PATCH/PUT/DELETE) with no `can(ctx…)`,
 *     `requirePerm(ctx…)` or `ctx.isAdmin` that is NOT in the exact-set baseline
 *     and NOT on the self-scoped allowlist is fatal;
 *   - a baselined route that has since been gated is fatal until its entry comes
 *     down, so an exemption cannot outlive the code it excused (shrink-only, the
 *     #3381 convention). The same applies to an allowlist entry whose route was
 *     gated or deleted.
 *
 * #3402's Fix section puts self-scoped routes (2FA, personal keys, notifications,
 * onboarding, per-user preferences) on an EXPLICIT allowlist with a one-line
 * reason each — a role gate there would deny a user access to their own data.
 * That allowlist is reviewed data, not a floor: every entry must name a live
 * ungated mutating route and carry a reason.
 *
 * This mirrors `check-permission-vocabulary.mjs`'s escape-hatch discipline:
 * missing/unreadable/malformed baseline or allowlist, a scan with no mutating
 * routes at all, or a git failure is a refusal, not a green run. A screen that
 * cannot enumerate the surface must never claim it is covered.
 *
 * Usage:
 *   node scripts/check-mutating-route-permissions.mjs
 *   node scripts/check-mutating-route-permissions.mjs --baseline <file> --allowlist <file>
 *   node scripts/check-mutating-route-permissions.mjs --update
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { resolve } from 'node:path';

export const DEFAULT_BASELINE_PATH = 'scripts/mutating-route-permissions-baseline.json';
export const DEFAULT_ALLOWLIST_PATH = 'scripts/mutating-route-self-scoped-allowlist.json';
export const SCAN_GLOB = 'app/api/tenant/**/route.ts';
export const MUTATING_EXPORT = /export const (POST|PATCH|PUT|DELETE)\b/;
/** The three shapes the #3402 census counted as a role gate. */
export const GATE = /\b(?:can|requirePerm)\s*\(\s*ctx\b|\bctx\.isAdmin\b/;

/**
 * Strip comments before looking for a gate: a TODO saying "needs requirePerm"
 * is not a gate. The `http://` escape keeps a URL in a string from being cut.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Pure: the sorted paths of mutating route files with no role gate. */
export function collectUngated(files) {
  return files
    .filter(({ source }) => {
      const code = stripComments(source);
      return MUTATING_EXPORT.test(code) && !GATE.test(code);
    })
    .map(({ path }) => path)
    .sort();
}

/**
 * Pure: { added, fixed } against an exact-set floor.
 * `added` are new ungated routes (fatal); `fixed` are stale exemptions (also
 * fatal, so the floor only ever shrinks).
 */
export function diffBaseline(ungated, baselineFiles) {
  const floor = new Set(baselineFiles);
  const live = new Set(ungated);
  return {
    added: ungated.filter((p) => !floor.has(p)),
    fixed: baselineFiles.filter((p) => !live.has(p)).sort(),
  };
}

/** Read the tracked tenant route sources. `root` makes the CLI testable. */
export function readSources(root = process.cwd()) {
  const paths = execFileSync('git', ['ls-files', '--', SCAN_GLOB], {
    cwd: root,
    encoding: 'utf8',
  }).split('\n').map((s) => s.trim()).filter(Boolean).sort();
  return paths.map((path) => ({ path, source: readFileSync(resolve(root, path), 'utf8') }));
}

export function readBaseline(path) {
  if (!existsSync(path)) throw new Error(`baseline missing: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed?.files) || parsed.files.some((p) => typeof p !== 'string')) {
    throw new Error(`baseline has no files[] list: ${path}`);
  }
  return parsed.files;
}

/** Read the reviewed self-scoped exemptions: path → one-line reason. */
export function readAllowlist(path) {
  if (!existsSync(path)) throw new Error(`allowlist missing: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const routes = parsed?.routes;
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
    throw new Error(`allowlist has no routes{} map: ${path}`);
  }
  for (const [route, reason] of Object.entries(routes)) {
    if (!route.startsWith('app/api/tenant/') || typeof reason !== 'string' || reason.trim().length < 10) {
      throw new Error(`allowlist entry needs a tenant route path and a real reason: ${route}`);
    }
  }
  return routes;
}

/**
 * Pure: split ungated routes into the documented self-scoped ones and the rest.
 * `stale` entries (now gated, or no longer a live route) must be removed by a
 * reviewer — the guard never silently forgets an exemption.
 */
export function applyAllowlist(ungated, allowlist, mutatingPaths) {
  const live = new Set(ungated);
  const mutating = new Set(mutatingPaths);
  const paths = Object.keys(allowlist).sort();
  return {
    remaining: ungated.filter((p) => !(p in allowlist)),
    exempted: ungated.filter((p) => p in allowlist),
    stale: paths.filter((p) => !live.has(p) || !mutating.has(p)),
  };
}

export function main(argv = process.argv.slice(2)) {
  let baselinePath = DEFAULT_BASELINE_PATH;
  let allowlistPath = DEFAULT_ALLOWLIST_PATH;
  let update = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--baseline') baselinePath = argv[++i];
    if (argv[i] === '--allowlist') allowlistPath = argv[++i];
    if (argv[i] === '--update') update = true;
  }

  const sources = readSources();
  const mutatingPaths = sources
    .filter(({ source }) => MUTATING_EXPORT.test(stripComments(source)))
    .map(({ path }) => path);
  if (mutatingPaths.length === 0) {
    console.error('[mutating-route-guard] no mutating tenant routes found — scan is broken; refusing');
    return 1;
  }
  const ungated = collectUngated(sources);

  let allowlist;
  try {
    allowlist = readAllowlist(allowlistPath);
  } catch (err) {
    console.error(`[mutating-route-guard] ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  const { remaining, exempted, stale } = applyAllowlist(ungated, allowlist, mutatingPaths);
  if (stale.length) {
    console.error(`[mutating-route-guard] allowlist entries no longer name an ungated mutating route — remove them:\n  ${stale.join('\n  ')}`);
    return 1;
  }
  if (update) {
    writeFileSync(baselinePath, `${JSON.stringify({
      note: 'Exact set of mutating tenant routes with no role gate and no self-scoped exemption (#3402). Shrink-only: a newly gated route is red until removed here; a new ungated route is red outright.',
      files: remaining,
    }, null, 2)}\n`);
    console.log(`[mutating-route-guard] baseline rewritten with ${remaining.length} path(s); ${exempted.length} self-scoped route(s) exempted`);
    return 0;
  }

  let baseline;
  try {
    baseline = readBaseline(baselinePath);
  } catch (err) {
    console.error(`[mutating-route-guard] ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  const { added, fixed } = diffBaseline(remaining, baseline);
  if (added.length || fixed.length) {
    if (added.length) console.error(`[mutating-route-guard] new ungated mutating route(s):\n  ${added.join('\n  ')}`);
    if (fixed.length) console.error(`[mutating-route-guard] now gated — remove from baseline:\n  ${fixed.join('\n  ')}`);
    return 1;
  }
  console.log(`[mutating-route-guard] OK — ${mutatingPaths.length} mutating route file(s), ${remaining.length} baselined ungated, ${exempted.length} self-scoped exempt; no new gaps`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = main();
}
