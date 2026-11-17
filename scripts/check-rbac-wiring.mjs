/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * RBAC wiring guard (#2597, the "the lib is green but nobody calls it" half).
 *
 * #2597 was not a missing-library bug: `lib/rbac/enforce.ts` and its unit tests
 * were green while not one production route called it, so an admin could hide
 * `amount` on deals from role `rep` and the deals API kept returning it. The
 * field-permission wiring itself is now pinned by `guard:field-permissions`;
 * this screen covers the wider class `guard:field-permissions` cannot see:
 *
 *   every exported FUNCTION in lib/rbac/ must have at least one production
 *   caller outside lib/rbac/, or be an explicit, reviewed baseline entry.
 *
 * Like the other escape-hatch guards (#3381/#3402/#3412), the baseline is
 * shrink-only and exact-set. A NEW unwired export is fatal; a baselined export
 * that becomes wired (or disappears) is fatal until its entry comes down. A
 * green unit suite proves the lib works — this proves the product uses it.
 *
 * Scope, deliberately:
 *   - Only `export (async) function` declarations are checked. Types and
 *     interfaces are compile-time contracts and need no runtime caller.
 *   - "Production" means tracked `app/**` and `lib/**` files outside
 *     `lib/rbac/`. Tests, scripts and docs are not callers: `tests/unit/rbac.test.ts`
 *     being green is exactly the false signal this screen exists to replace.
 *   - A caller must BOTH import the name from a lib/rbac module AND invoke it.
 *     Mentioning it in a comment (or importing it without calling it) is not a
 *     caller; comments are stripped before either test runs.
 *
 * Usage (from the repo root):
 *   node scripts/check-rbac-wiring.mjs
 *   node scripts/check-rbac-wiring.mjs --baseline <file> --root <dir>
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const DEFAULT_BASELINE_PATH = 'scripts/rbac-wiring-baseline.json';
export const RBAC_DIR = 'lib/rbac';
export const PRODUCTION_GLOBS = ['app/**/*.ts', 'app/**/*.tsx', 'lib/**/*.ts', 'lib/**/*.tsx'];

/** Strip comments so a TODO naming a function is never mistaken for a caller. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Pure — enumerate exported functions in lib/rbac sources as `${file}:${name}`. */
export function collectRbacExports(files, readFile) {
  const out = [];
  for (const file of files) {
    const src = stripComments(readFile(file));
    for (const m of src.matchAll(/^[ \t]*export\s+(?:async\s+)?function\s+(\w+)/gm)) {
      out.push({ id: `${file}:${m[1]}`, file, name: m[1] });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Pure — true when a source imports `name` from a lib/rbac module and calls it. */
export function isCaller(source, name) {
  const code = stripComments(source);
  const imported =
    new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"][^'"]*\\brbac(?:/|['"])`, 'm').test(code) ||
    new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s*['"][^'"]*\\brbac(?:/|['"])`, 'm').test(code);
  return imported && new RegExp(`\\b${name}\\s*\\(`, 'm').test(code);
}

/** Production sources are app/** and lib/** — tests are the false signal this screen replaces. */
export function isProductionPath(path) {
  return /^(app|lib)\//.test(path) && !/^lib\/rbac\//.test(path) && !/(^|\/)tests?\//.test(path);
}

/** Pure — map every export id to its production callers. */
export function findCallers(exports, sources) {
  return new Map(
    exports.map((e) => [
      e.id,
      sources.filter((s) => isProductionPath(s.path) && isCaller(s.source, e.name)).map((s) => s.path),
    ]),
  );
}

/** Read tracked production sources; `root` makes the CLI testable. */
export function readProductionSources(root = ROOT) {
  const paths = execFileSync('git', ['ls-files', '--', ...PRODUCTION_GLOBS], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p && !p.startsWith(`${RBAC_DIR}/`))
    .sort();
  return paths.map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }));
}

/** Read tracked lib/rbac sources; `root` makes the CLI testable. */
export function readRbacSources(root = ROOT) {
  const paths = execFileSync('git', ['ls-files', '--', `${RBAC_DIR}/**/*.ts`, `${RBAC_DIR}/*.ts`], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  return paths.map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }));
}

export function readBaseline(path) {
  if (!existsSync(path)) throw new Error(`baseline missing: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const entries = parsed?.exports;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error(`baseline has no exports{} map: ${path}`);
  }
  for (const [id, reason] of Object.entries(entries)) {
    if (!id.startsWith(`${RBAC_DIR}/`) || typeof reason !== 'string' || reason.trim().length < 10) {
      throw new Error(`baseline entry needs a lib/rbac file:name id and a real reason: ${id}`);
    }
  }
  return entries;
}

/**
 * Pure — diff the live unwired set against the exact-set baseline.
 * `added` are new unwired exports (fatal); `wired` are stale exemptions (also
 * fatal, so the floor only ever shrinks); `gone` name an export that no longer
 * exists and whose entry must be removed too.
 */
export function diffBaseline(unwiredIds, baseline) {
  const live = new Set(unwiredIds);
  const floor = new Set(Object.keys(baseline));
  return {
    added: unwiredIds.filter((id) => !floor.has(id)).sort(),
    wired: [...floor].filter((id) => !live.has(id)).sort(),
    gone: [], // filled by main() where the full export set is in scope
  };
}

export function main(argv = process.argv.slice(2)) {
  let baselinePath = DEFAULT_BASELINE_PATH;
  let root = ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--baseline') baselinePath = argv[++i];
    if (argv[i] === '--root') root = argv[++i];
  }

  let rbacSources, prodSources, baseline;
  try {
    rbacSources = readRbacSources(root);
    prodSources = readProductionSources(root);
    baseline = readBaseline(resolve(root, baselinePath));
  } catch (err) {
    console.error(`[rbac-wiring-guard] ${err instanceof Error ? err.message : err}`);
    return 1;
  }

  const exports = collectRbacExports(
    rbacSources.map((s) => s.path),
    (p) => rbacSources.find((s) => s.path === p).source,
  );
  if (exports.length === 0) {
    console.error('[rbac-wiring-guard] no exported lib/rbac functions found — scan is broken; refusing');
    return 1;
  }
  if (prodSources.length === 0) {
    console.error('[rbac-wiring-guard] no production sources found — scan is broken; refusing');
    return 1;
  }

  const callers = findCallers(exports, prodSources);
  const unwired = exports.filter((e) => callers.get(e.id).length === 0).map((e) => e.id);
  const { added, wired } = diffBaseline(unwired, baseline);
  const liveIds = new Set(exports.map((e) => e.id));
  const gone = Object.keys(baseline).filter((id) => !liveIds.has(id)).sort();

  if (added.length || wired.length || gone.length) {
    if (added.length) {
      console.error(`[rbac-wiring-guard] new lib/rbac export(s) with no production caller — wire it or add a reviewed baseline entry:\n  ${added.join('\n  ')}`);
    }
    if (wired.length) {
      console.error(`[rbac-wiring-guard] these exports ARE wired now — remove the stale baseline entry (shrink-only):\n  ${wired.join('\n  ')}`);
    }
    if (gone.length) {
      console.error(`[rbac-wiring-guard] baseline names an export that no longer exists — remove the entry:\n  ${gone.join('\n  ')}`);
    }
    return 1;
  }

  console.log(
    `[rbac-wiring-guard] OK — ${exports.length} exported lib/rbac function(s), ` +
      `${exports.length - unwired.length} with a production caller, ${unwired.length} reviewed baseline entr${unwired.length === 1 ? 'y' : 'ies'}; ` +
      `no new unwired exports (#2597).`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
