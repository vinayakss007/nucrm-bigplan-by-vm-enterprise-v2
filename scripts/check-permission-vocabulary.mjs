/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Permission vocabulary guard (#3402).
 *
 * The catalog in `lib/permissions/definitions.ts` is the ONLY list the Roles UI
 * offers — `app/tenant/settings/roles/page.tsx` renders `PERMISSIONS` and nothing
 * else — and `can()` reads exactly one key: `ctx.permissions[perm]`. So the ids the
 * catalog declares and the strings the handlers check are one system, and on `main`
 * they disagreed in both directions:
 *
 *   - **21 enforced strings were not in the catalog** (`projects.create`,
 *     `contacts.view`, `calendar.manage`, …). A handler asked for a permission no
 *     role could ever hold, so every non-admin was 403 forever and the Roles UI had
 *     no checkbox to fix it. That is not a missing grant — it is an ungrantable
 *     check, the same class as a typo'd column name, except it only surfaces as
 *     "the customer says the button is broken".
 *   - **14 catalog ids were never enforced anywhere.** The UI offers "Create
 *     Invoices", the owner ticks it or not, and `POST /api/tenant/invoices` answers
 *     the same either way. A control that is configured but never read is exactly
 *     the finding #3402 headlines: *any member can create or send an invoice*.
 *
 * Neither direction was visible to anything: `tsc` sees `requirePerm(ctx, 'x')` as
 * `string`, the catalog is data, and the Roles UI iterates whatever it is handed. So
 *
 *   - an **undeclared literal check is fatal, with no baseline escape** — a check
 *     nobody can grant is a lockout, and the fix is always to declare the id or stop
 *     checking it, never to grandfather the lockout;
 *   - an **inert catalog id is a shrink-only floor** in
 *     `scripts/permission-vocabulary-baseline.json`. Adding enforcement is the
 *     entity-by-entity policy change #3402 asks for, which is the owner's call and
 *     not this screen's, so today's set is recorded with a reason. A NEW inert id is
 *     red, and an id that becomes enforced is red until its entry comes down, so an
 *     exemption cannot outlive its code (#3381's convention);
 *   - a **dynamic check** (`requirePerm(ctx, \`${table}.edit\`)`, as
 *     `app/api/tenant/data-explorer/route.ts:292,367`) is not a literal and is not
 *     counted as one. Its static suffix marks every id ending in `.edit` / `.delete`
 *     as *possibly* enforced — which is why `projects.edit` is not on the floor. The
 *     screen refuses to call an id inert when a dynamic site could reach it, and
 *     says so in its output instead of guessing.
 *
 * Fails closed on the environment as well as on findings: a missing, unreadable or
 * id-less catalog, a scan that finds no checks at all (the extractor broke, or
 * `app/`/`lib/` vanished), an unparsable, malformed, duplicated or absent baseline
 * are each a refusal with a reason and exit 1. A screen that cannot read the
 * vocabulary must never report "consistent".
 *
 * Usage:
 *   node scripts/check-permission-vocabulary.mjs [--json]
 *   node scripts/check-permission-vocabulary.mjs --catalog <file> --baseline <file>
 *   node scripts/check-permission-vocabulary.mjs --update    # rewrite the floor from live inert ids
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULT_CATALOG_PATH = 'lib/permissions/definitions.ts';
export const DEFAULT_BASELINE_PATH = 'scripts/permission-vocabulary-baseline.json';
export const SCAN_PREFIXES = ['app', 'lib'];

/** Which helper names count as enforcement. `ownerScope` reads a permission to pick a row scope. */
export const CHECK_FNS = ['can', 'requirePerm', 'ownerScope'];

const ID_SHAPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/**
 * The catalog's ids in declaration order, with the hygiene problems separated out
 * rather than silently dropped. An id that does not parse as `resource.action` is
 * kept — it is still grantable — but reported.
 */
export function parseCatalog(source) {
  const ids = [];
  const malformed = [];
  const seen = new Set();
  const duplicates = [];
  for (const line of source.split('\n')) {
    const m = /^\s*\{ id: '([^']+)'/.exec(line);
    if (!m) continue;
    const id = m[1];
    ids.push(id);
    if (!ID_SHAPE.test(id)) malformed.push(id);
    if (seen.has(id) && !duplicates.includes(id)) duplicates.push(id);
    seen.add(id);
  }
  return { ids, unique: [...new Set(ids)], duplicates, malformed };
}

/**
 * Every enforcement site in one file. Comment lines are skipped: a `// TODO:
 * requirePerm(ctx, 'x')` in prose is not a check. Matches are taken per line, which
 * is how all three helpers are called — the fixture suite asserts it.
 *
 * A template call is recorded with its raw text and `dynamic: true`, never as an id.
 */
export function collectChecks(source, path) {
  const found = [];
  const literal = new RegExp(`\\b(?:${CHECK_FNS.join('|')})\\(\\s*[^,()]*,\\s*'([^']+)'`, 'g');
  const template = new RegExp(`\\b(?:${CHECK_FNS.join('|')})\\(\\s*[^,()]*,\\s*\`([^\`]*)\``, 'g');
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const m of line.matchAll(literal)) found.push({ id: m[1], path, line: i + 1 });
    for (const m of line.matchAll(template)) found.push({ id: m[1], path, line: i + 1, dynamic: true });
  }
  return found;
}

/** Static suffixes a dynamic check can reach, e.g. `['.edit', '.delete']`. */
export function dynamicSuffixes(checks) {
  const out = new Set();
  for (const c of checks) {
    if (!c.dynamic) continue;
    const cut = c.id.lastIndexOf('}');
    const suffix = cut < 0 ? c.id : c.id.slice(cut + 1);
    if (suffix) out.add(suffix);
  }
  return [...out];
}

/**
 * The verdict, pure: catalog ids + checks + the recorded floor in, findings out.
 *
 * kinds — `undeclared` (fatal, no escape), `new-inert` (fatal), `stale-floor`
 * (fatal: an entry whose id is enforced again), `duplicate-id`, `malformed-id`.
 */
export function computeDelta({ catalogIds, duplicates, malformed, checks, floor }) {
  const declared = new Set(catalogIds);
  const literals = checks.filter((c) => !c.dynamic);
  const checkedIds = new Set(literals.map((c) => c.id));
  const suffixes = dynamicSuffixes(checks);
  const siteOf = new Map();
  for (const c of literals) if (!siteOf.has(c.id)) siteOf.set(c.id, c);

  const undeclared = [...checkedIds]
    .filter((id) => !declared.has(id))
    .map((id) => ({ id, path: siteOf.get(id).path, line: siteOf.get(id).line }));

  const isEnforced = (id) => checkedIds.has(id) || suffixes.some((s) => id.endsWith(s));
  const inert = catalogIds.filter((id) => !isEnforced(id));
  const floorIds = floor.map((f) => f.id);

  const findings = [
    ...undeclared.map((u) => ({ kind: 'undeclared', id: u.id, path: u.path, line: u.line })),
    ...inert.filter((id) => !floorIds.includes(id)).map((id) => ({ kind: 'new-inert', id })),
    ...floorIds.filter((id) => !inert.includes(id)).map((id) => ({ kind: 'stale-floor', id })),
    ...duplicates.map((id) => ({ kind: 'duplicate-id', id })),
    ...malformed.map((id) => ({ kind: 'malformed-id', id })),
  ];

  return {
    findings,
    counts: {
      catalog: catalogIds.length,
      checked: checkedIds.size,
      dynamic: checks.filter((c) => c.dynamic).length,
      suffixes,
      inert: inert.length,
      floor: floorIds.length,
    },
    inert,
  };
}

function trackedFiles(cwd, prefixes) {
  return execFileSync('git', ['ls-files', '--', ...prefixes], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .filter((f) => /\.tsx?$/.test(f));
}

export function run(root = process.cwd(), opts = {}) {
  const catalogPath = opts.catalog ?? DEFAULT_CATALOG_PATH;
  const baselinePath = opts.baseline ?? DEFAULT_BASELINE_PATH;

  if (!existsSync(resolve(root, catalogPath))) throw new Error(`catalog not found: ${catalogPath}`);
  const catalog = parseCatalog(readFileSync(resolve(root, catalogPath), 'utf8'));
  if (catalog.unique.length === 0) {
    throw new Error(`${catalogPath} declares no permission ids — the extractor found none, which is a broken screen, not a clean tree`);
  }

  const files = trackedFiles(root, SCAN_PREFIXES);
  if (files.length === 0) throw new Error(`no .ts/.tsx files tracked under ${SCAN_PREFIXES.join('/')}`);

  const checks = [];
  const unreadable = [];
  for (const f of files) {
    try {
      checks.push(...collectChecks(readFileSync(resolve(root, f), 'utf8'), f));
    } catch (e) {
      unreadable.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (unreadable.length > 0) throw new Error(`unparsable source(s): ${unreadable.join('; ')}`);
  if (!checks.some((c) => !c.dynamic)) {
    throw new Error(`no permission check found in ${files.length} file(s) under ${SCAN_PREFIXES.join('/')} — a tree with zero enforced permissions is not this project`);
  }

  const baselineFile = resolve(root, baselinePath);
  const floorMissing = !existsSync(baselineFile);
  let floor = [];
  if (!floorMissing) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(baselineFile, 'utf8'));
    } catch (e) {
      throw new Error(`baseline ${baselinePath} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!Array.isArray(parsed.inert)) throw new Error(`baseline ${baselinePath} has no "inert" array`);
    for (const entry of parsed.inert) {
      if (typeof entry.id !== 'string' || typeof entry.reason !== 'string' || !entry.reason.trim()) {
        throw new Error(`baseline ${baselinePath} holds an entry without a string id and a written reason — an exemption without a reason is not reviewable`);
      }
    }
    const ids = parsed.inert.map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) throw new Error(`baseline ${baselinePath} lists ${dupes.join(', ')} twice`);
    floor = parsed.inert;
  }

  const delta = computeDelta({
    catalogIds: catalog.unique,
    duplicates: catalog.duplicates,
    malformed: catalog.malformed,
    checks,
    floor,
  });

  return { ...delta, filesScanned: files.length, catalogPath, baselinePath, floorMissing };
}

const EXPLAIN = {
  undeclared:
    "a handler requires a permission the catalog does not declare, so NO role can ever hold it and every non-admin is locked out of that route. Declare the id in lib/permissions/definitions.ts or stop checking it — there is no baseline for this one.",
  'new-inert':
    'a catalog id no handler enforces: the Roles UI can tick it and nothing reads it. Either wire the check or take the id out of the catalog.',
  'stale-floor':
    'recorded in the floor but no longer inert — the enforcement landed, so delete the entry. An exemption cannot outlive its code.',
  'duplicate-id': 'declared twice in the catalog — one checkbox in the Roles UI meaning two things.',
  'malformed-id': 'is not shaped resource.action — the catalog, the handlers and the Roles UI cannot agree on a string like this.',
};

export function main(argv = process.argv.slice(2)) {
  const args = argv.slice();
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
  };
  const opts = { catalog: take('--catalog'), baseline: take('--baseline') };
  const json = args.includes('--json');
  const update = args.includes('--update');

  let result;
  try {
    result = run(process.cwd(), opts);
  } catch (e) {
    console.error(`[check-permission-vocabulary] REFUSED — ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  if (update) {
    const payload = {
      note: 'Shrink-only floor of catalog ids that no handler enforces yet (#3402). A new inert id is red; an id that becomes enforced is red until its entry comes down.',
      inert: result.inert.map((id) => ({
        id,
        reason:
          'PR-2E of #3402: the Roles UI offers this id and no handler requires it. Enforcement is the entity-by-entity policy change the issue asks for, so this entry doubles as its to-do list.',
      })),
    };
    writeFileSync(resolve(process.cwd(), opts.baseline ?? DEFAULT_BASELINE_PATH), JSON.stringify(payload, null, 2) + '\n');
    console.log(`[check-permission-vocabulary] wrote ${result.inert.length} inert id(s) to ${opts.baseline ?? DEFAULT_BASELINE_PATH}`);
    return 0;
  }

  if (json) console.log(JSON.stringify({ ...result.counts, filesScanned: result.filesScanned, findings: result.findings }, null, 2));

  const fatal = result.findings;
  if (result.floorMissing) {
    console.error('[check-permission-vocabulary] REFUSED — the floor file is missing; an absent baseline is not an empty one.');
    return 1;
  }
  if (fatal.length === 0) {
    // With --json stdout carries the verdict and nothing else, so a caller can parse it.
    if (!json) {
      console.log(
        `[check-permission-vocabulary] OK — ${result.counts.catalog} catalog id(s), ${result.counts.checked} enforced literally across ${result.filesScanned} file(s)` +
          (result.counts.dynamic > 0 ? `, ${result.counts.dynamic} dynamic site(s) reaching ${result.counts.suffixes.join(' or ')}` : '') +
          `; ${result.counts.inert} id(s) are grantable-but-unenforced and all ${result.counts.floor} are recorded in ${result.baselinePath} (#3402).`,
      );
    }
    return 0;
  }

  console.error(`[check-permission-vocabulary] ✖ ${fatal.length} permission-vocabulary problem(s) (#3402):`);
  for (const f of fatal) {
    const where = f.path ? ` (${f.path}:${f.line})` : '';
    console.error(`    - ${f.kind}: '${f.id}'${where}`);
    console.error(`        ${EXPLAIN[f.kind] ?? ''}`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
