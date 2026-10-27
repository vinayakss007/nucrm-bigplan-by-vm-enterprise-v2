#!/usr/bin/env node
/**
 * #3282 — a destructive script with no opt-in is a `prod:seed` waiting to happen.
 *
 * `npm run prod:seed` (`npx tsx scripts/seed-fresh.ts`) deletes every
 * user/tenant/role/session/pipeline/deal stage in whatever `DATABASE_URL` points
 * at, then plants a super admin whose password is committed to this public
 * repository. Ask #4 of #3282 is not about that one script: it is that
 * `db:drop`, `db:reset`, `db:rollback`, `backup:restore` and `db:bootstrap-test`
 * sit in the same documentation table and are all reachable by name — and none of
 * them was *provably* gated, because nothing in this repository read the scripts
 * and asked. THAT is the rot this screen stops: a gate that exists today is a
 * fact, and a fact nobody checks is a fact that quietly stops being true the
 * first time someone copies the script, drops the flag handling and keeps the
 * `DROP SCHEMA`.
 *
 * NOTHING-EXISTING-CATCHES EVIDENCE, measured rather than assumed on this tree:
 * `guard:seed-credential` (#3281) reads password literals and never looks at what
 * a script DOES to a database — its own baseline says so
 * (`scripts/seed-credentials-baseline.json`: "removing them means rewriting what
 * those scripts do to a database, which is #3282's ask"); `guard:raw-sql`
 * (`scripts/check-raw-sql-sinks.mjs`) screens interpolation into a query, and an
 * interpolated `DROP SCHEMA` is still an un-gated wipe; `guard:migration-rls`,
 * `guard:catalog-grants` and `check-db-role-privileges.mjs` all read the DATABASE,
 * which CI has none of; `guard:rollback-coverage` asserts a `.down.sql` EXISTS,
 * not that running it was confirmed. `grep -rn "DROP SCHEMA" scripts/check-*.mjs`
 * is empty apart from this file. So nothing screened the axis this issue is about.
 *
 * WHAT IT READS. Only what `package.json` wires up: every entry whose command runs
 * `tsx`/`node` on a `scripts/**` file (an alias that names no file, e.g.
 * `db:studio`'s `node -e`, or a loader passed with `--import`, contributes nothing
 * rather than crashing). That is the surface a human can reach by name, which is
 * exactly the set #3282 ask #4 lists.
 *
 * THE RULES, all textual — no database, no credentials, no network:
 *
 *   SCHEMA_WIPE_UNGATED    a `DROP SCHEMA` / `DROP DATABASE` statement literal, or
 *                          the `CREATE SCHEMA public` / `GRANT ALL ON SCHEMA` half
 *                          of a wipe-and-rebuild, in a script whose own source
 *                          names no opt-in. The DROPs are full wipes, so naming
 *                          `--dry-run` alone does NOT clear them: they need
 *                          `--yes`/`--confirm`.
 *   TABLE_WIPE_UNGATED     a `TRUNCATE` / `DROP TABLE` statement literal, same
 *                          gate rule (`TRUNCATE` is a full wipe, `DROP TABLE` is
 *                          not).
 *   UNSCOPED_DELETE_UNGATED a Drizzle whole-table delete (`db.delete(x)` with no
 *                          `.where(` in its statement) or a `DELETE FROM` literal
 *                          with no `WHERE` — a full wipe, so `--yes`/`--confirm`
 *                          is required. `DELETE FROM t WHERE id = $1` is a scoped
 *                          delete and is never a finding.
 *   BASELINE_STALE         an allowance whose site is gone — the ratchet is
 *                          shrink-only, so a gated or deleted script must have its
 *                          entry lowered here, not silently kept.
 *   BASELINE_UNREASONED    an allowance with no reason recorded in the baseline's
 *                          `_reasons` object: an exemption nobody owned is the same
 *                          as a gate that quietly stops being true.
 *
 * A script is CLEAN only when it is not destructive, or when its own source
 * references `--yes` / `--confirm` (plus any opt-in at all, which includes
 * `--dry-run` and a `NUCRM_ALLOW_*` env read, for the non-full-wipe signatures).
 * Signatures are read inside string literals and templates only, and comments are
 * stripped first: prose about a `DROP TABLE` (which `check-down-migration-coverage
 * .mjs` contains a dozen of) is not a statement, and a `--yes` that only appears
 * in a header comment does not gate anything either.
 *
 * Usage:
 *   node scripts/check-destructive-gate.mjs
 *   node scripts/check-destructive-gate.mjs --json
 *   node scripts/check-destructive-gate.mjs --explain
 *   node scripts/check-destructive-gate.mjs --root <fixture-dir>
 *   node scripts/check-destructive-gate.mjs --baseline <path> [--update|--print-baseline]
 *
 * Exit: 0 clean (or a baseline that only needs shrinking, reported), 1 findings or
 * a widened ratchet, 2 not applicable — no package.json, or nothing in it runs a
 * script file.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argvRoot = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(argvRoot ?? path.resolve(HERE, '..'));
const DEFAULT_BASELINE = path.resolve(HERE, 'destructive-gate-baseline.json');
const SELF = 'scripts/check-destructive-gate.mjs';

/** Why each screen exists, surfaced by --explain and in every finding. */
const explanations = {
  SCHEMA_WIPE_UNGATED: 'drops/rewrites the schema the whole app lives in',
  TABLE_WIPE_UNGATED: 'empties or removes tables',
  UNSCOPED_DELETE_UNGATED: 'deletes every row of a table with no WHERE',
  BASELINE_STALE: 'an allowance whose site is gone — shrink-only ratchet (#3282)',
  BASELINE_UNREASONED: 'an allowance with no recorded reason, so no reviewer owned it',
};

/**
 * Statement signatures, read only inside string literals/templates. `fullWipe` is
 * the #3282 line: what removes everything the connection can see, and therefore
 * needs `--yes`/`--confirm` rather than any opt-in at all.
 */
const SQL_SIGNATURES = [
  { check: 'SCHEMA_WIPE_UNGATED', re: /DROP\s+SCHEMA\b/gi, fullWipe: true, label: 'DROP SCHEMA' },
  { check: 'SCHEMA_WIPE_UNGATED', re: /DROP\s+DATABASE\b/gi, fullWipe: true, label: 'DROP DATABASE' },
  { check: 'SCHEMA_WIPE_UNGATED', re: /CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|"|')?public/gi, fullWipe: false, label: 'CREATE SCHEMA public' },
  { check: 'SCHEMA_WIPE_UNGATED', re: /GRANT\s+ALL\s+ON\s+SCHEMA\b/gi, fullWipe: false, label: 'GRANT ALL ON SCHEMA' },
  // `TRUNCATE <table>` / `TRUNCATE TABLE <table>`, with word boundaries on both
  // sides so `results_truncated` and a `truncate()` import are not statements.
  { check: 'TABLE_WIPE_UNGATED', re: /\bTRUNCATE\b\s+(?:TABLE\s+)?[a-z_"]/gi, fullWipe: true, label: 'TRUNCATE' },
  { check: 'TABLE_WIPE_UNGATED', re: /DROP\s+TABLE\b/gi, fullWipe: false, label: 'DROP TABLE' },
];

/**
 * A literal that carries regex syntax is a matcher, not a statement: the
 * `check-down-migration-coverage.mjs` builder `` re(`DROP TABLE (?:IF EXISTS
 * )?(?:public\\.)?${ID}`, 'gi') `` describes a migration file rather than running
 * anything, and no Postgres statement contains `(?:` or a backslash escape.
 */
const REGEX_SOURCE = /\(\?|\\[sdwbWSDB]|\\\[|\/[a-z]*$/;

/** The opt-in vocabulary, and the two tokens a full wipe actually needs. */
const OPT_IN_TOKENS = ['--yes', '--confirm', '--dry-run', 'NUCRM_ALLOW_'];
const CONFIRM_TOKENS = ['--yes', '--confirm'];

/**
 * A Drizzle whole-table delete: `db.delete(table)` with no `.where(` anywhere in
 * the same statement. The receiver is pinned to a connection/transaction name and
 * requires the character before it not to be `.`, so `map.delete(k)`,
 * `this.jar.delete(name)` and `cache.delete(key)` are not table wipes.
 */
const DRIZZLE_DELETE = /(?:^|[^\w$.])(?:db|drizzle|tx|trx|transaction|client|conn|pool)\s*\.\s*delete\s*\(/g;
const DELETE_FROM = /DELETE\s+FROM\b/gi;
const STATEMENT_WINDOW = 600;

/**
 * Derive the reachable script surface from package.json — never a hardcoded list,
 * because a hardcoded list is the thing that rots. A command is split on `&&`,
 * `;`, `|` and newlines and each segment is kept only if it runs `tsx`/`node`;
 * path tokens inside a segment become targets unless a flag (`--import`,
 * `--require`, `-r`) marks them as a loader. Segments that name no script file —
 * `node -e`, `npm run x`, a bare `next build` — contribute nothing.
 *
 * @returns {Map<string, string[]>} repo-relative script file -> npm script names
 */
export function deriveTargets(root = ROOT) {
  const pkgPath = path.resolve(root, 'package.json');
  if (!existsSync(pkgPath)) return null;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {};
  const out = new Map();
  const PATH_TOKEN = /(?:\.{0,2}\/)?scripts\/[\w./-]+?\.(?:ts|tsx|mts|mjs|cjs|js)\b/g;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (typeof cmd !== 'string') continue;
    for (const segment of cmd.split(/&&|;|\||\n|\$\(/)) {
      if (!/(?:^|[^\w./-])(?:npx\s+)?(?:tsx|node)(?=[\s=-]|$)/.test(segment)) continue;
      let m;
      PATH_TOKEN.lastIndex = 0;
      while ((m = PATH_TOKEN.exec(segment)) !== null) {
        const before = segment.slice(0, m.index);
        if (/(?:--import|--require|-r)[=\s]+$/.test(before)) continue; // a loader, not the target
        const rel = m[0].replace(/^\.\//, '').replace(/^\.\.\//, '');
        if (!rel.startsWith('scripts/')) continue;
        if (rel === SELF) continue; // the patterns live in this file
        const seen = out.get(rel) ?? [];
        if (!seen.includes(name)) out.set(rel, seen.concat(name));
        PATH_TOKEN.lastIndex = m.index + m[0].length;
      }
    }
  }
  return out;
}

/**
 * One pass, two streams, both with comments blanked and identical offsets (so a
 * line number found in either is the line a human sees):
 *
 *   `text`   comments gone, string literals kept VERBATIM — this is what an
 *            opt-in is read from, because `'--confirm'` is a string. A `--yes`
 *            that survives only in a prose comment does not gate anything.
 *   `masked` literals blanked as well — this is what CODE patterns (`db.delete(`)
 *            are read from, so a help string quoting that call is not a wipe.
 *
 * @returns {{text: string, masked: string, literals: Array<{value: string, line: number, template: boolean}>}}
 */
export function readSource(source) {
  const text = [];
  const masked = [];
  const literals = [];
  let i = 0;
  let line = 1;
  const blank = (s) => {
    for (const ch of s) {
      text.push(ch === '\n' ? '\n' : ' ');
      masked.push(ch === '\n' ? '\n' : ' ');
    }
    line += s.split('\n').length - 1;
  };
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith('//')) {
      const nl = source.indexOf('\n', i);
      blank(source.slice(i, nl === -1 ? source.length : nl));
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    const q = source[i];
    if (q === "'" || q === '"' || q === '`') {
      const startLine = line;
      let j = i + 1;
      let value = '';
      text.push(q);
      masked.push(q);
      while (j < source.length) {
        if (source[j] === '\\') {
          value += source[j + 1] === '\n' ? '\n' : (source[j + 1] ?? '');
          text.push(source.slice(j, j + 2));
          masked.push('  ');
          if (source[j + 1] === '\n') line++;
          j += 2;
          continue;
        }
        if (source[j] === q) break;
        if (source[j] === '\n') {
          line++;
          value += '\n';
          text.push('\n');
          masked.push('\n');
          j++;
          continue;
        }
        if (q === '`' && source.startsWith('${', j)) {
          // One literal, not two: `DELETE FROM ${id} WHERE …` must be read whole,
          // so the interpolation is carried as its own text and scanning resumes
          // after the closing brace instead of starting a fresh literal.
          let depth = 1;
          let k = j + 2;
          value += '${';
          text.push('${');
          masked.push('  ');
          while (k < source.length && depth > 0) {
            if (source[k] === '{') depth++;
            else if (source[k] === '}') depth--;
            if (depth > 0) value += source[k];
            text.push(source[k]);
            masked.push(source[k] === '\n' ? '\n' : ' ');
            if (source[k] === '\n') line++;
            k++;
          }
          value += '}';
          j = k;
          continue;
        }
        value += source[j];
        text.push(source[j]);
        masked.push(' ');
        j++;
      }
      literals.push({ value, line: startLine, template: q === '`' });
      if (source[j] === q) {
        text.push(source[j]);
        masked.push(source[j]);
      }
      i = j + 1;
      continue;
    }
    text.push(q);
    masked.push(q);
    if (q === '\n') line++;
    i++;
  }
  return { text: text.join(''), masked: masked.join(''), literals };
}

/** The text of the statement a match sits in: up to the next `;` or a safe cap. */
function statementAt(code, from) {
  let depth = 0;
  const cap = Math.min(code.length, from + STATEMENT_WINDOW);
  for (let i = from; i < cap; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
    else if (ch === ';' && depth === 0) return code.slice(from, i);
  }
  return code.slice(from, cap);
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const lineText = (text, n) => text.split('\n')[n - 1] ?? '';

/**
 * @returns {{findings: Array, allowed: number, hits: Array, targets: Map}|{notApplicable: true}}
 */
export function analyse({ root = ROOT, baseline = {} } = {}) {
  const targets = deriveTargets(root);
  if (!targets || targets.size === 0) return { notApplicable: true, findings: [], allowed: 0, hits: [], targets: targets ?? new Map() };

  const hits = [];
  const seen = new Set();
  const add = (check, file, line, detail, source) => {
    const key = `${check}|${file}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      check,
      file,
      line,
      detail: `${detail} (${explanations[check]})`,
      source: (source ?? '').trim(),
      npmScripts: targets.get(file) ?? [],
    });
  };

  for (const rel of [...targets.keys()].sort()) {
    const full = path.resolve(root, rel);
    if (!existsSync(full)) continue; // a wired-up script that is not on disk: nothing to read
    let raw;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const { text, masked, literals } = readSource(raw);
    const names = (tokens) => tokens.filter((t) => text.includes(t));
    const gateNote = (needed, found) => found.length
      ? `it names ${found.join(' / ')} but a full wipe must be confirmed with ${CONFIRM_TOKENS.join(' or ')}`
      : `it names none of ${needed.join(' / ')}`;

    // 1. SQL statement signatures, inside literals only.
    for (const sig of SQL_SIGNATURES) {
      const needed = sig.fullWipe ? CONFIRM_TOKENS : OPT_IN_TOKENS;
      if (names(needed).length > 0) continue; // this script gates itself
      for (const lit of literals) {
        if (REGEX_SOURCE.test(lit.value)) continue; // a matcher, not a statement
        sig.re.lastIndex = 0;
        let m;
        while ((m = sig.re.exec(lit.value)) !== null) {
          if (m[0].length === 0) { sig.re.lastIndex++; continue; }
          const at = lit.line + lit.value.slice(0, m.index).split('\n').length - 1;
          add(sig.check, rel, at,
            `${rel} runs ${sig.label} — ${gateNote(needed, names(OPT_IN_TOKENS))}`,
            lineText(text, at));
          break; // one finding per literal per signature names the site well enough
        }
      }
    }

    // 2. DELETE FROM inside a literal, statement by statement: no WHERE = every row.
    if (names(CONFIRM_TOKENS).length === 0) {
      for (const lit of literals) {
        if (REGEX_SOURCE.test(lit.value)) continue;
        DELETE_FROM.lastIndex = 0;
        let dm;
        while ((dm = DELETE_FROM.exec(lit.value)) !== null) {
          if (dm[0].length === 0) { DELETE_FROM.lastIndex++; continue; }
          const tail = lit.value.slice(dm.index);
          const stop = tail.indexOf(';');
          const body = stop === -1 ? tail : tail.slice(0, stop);
          if (/\bWHERE\b/i.test(body)) continue;
          const at = lit.line + lit.value.slice(0, dm.index).split('\n').length - 1;
          add('UNSCOPED_DELETE_UNGATED', rel, at,
            `${rel} runs a DELETE FROM with no WHERE — ${gateNote(CONFIRM_TOKENS, names(OPT_IN_TOKENS))}`,
            lineText(text, at));
        }
      }
    }

    // 3. Drizzle whole-table deletes, in code (literals masked out).
    if (names(CONFIRM_TOKENS).length === 0) {
      DRIZZLE_DELETE.lastIndex = 0;
      let bm;
      while ((bm = DRIZZLE_DELETE.exec(masked)) !== null) {
        if (bm[0].length === 0) { DRIZZLE_DELETE.lastIndex++; continue; }
        const stmt = statementAt(masked, bm.index);
        if (/\.where\s*\(|\.filter\s*\(/i.test(stmt)) continue; // scoped delete
        const at = lineOf(masked, bm.index);
        add('UNSCOPED_DELETE_UNGATED', rel, at,
          `${rel} deletes a whole table (${stmt.replace(/\s+/g, ' ').trim().slice(0, 90)}) — ${
            gateNote(CONFIRM_TOKENS, names(OPT_IN_TOKENS))}`,
          lineText(text, at));
      }
    }
  }

  // Allowances are consumed in scan order, per file and check: an entry says
  // "this many of these, in this file", and nothing about which line moved.
  const used = new Map();
  const findings = [];
  let allowed = 0;
  for (const h of hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))) {
    const key = `${h.file}|${h.check}`;
    const cap = baseline[key] ?? 0;
    const soFar = used.get(key) ?? 0;
    if (soFar < cap) {
      used.set(key, soFar + 1);
      allowed++;
      continue;
    }
    findings.push(h);
  }

  // A baseline entry that matched nothing is stale: an exemption must not outlive
  // the code, and a script that got gated must shrink here (#3282, shrink-only).
  for (const [key, n] of Object.entries(baseline)) {
    if (key === '_comment' || typeof n !== 'number') continue;
    const got = used.get(key) ?? 0;
    if (got < n) {
      const file = key.split('|')[0];
      findings.push({
        check: 'BASELINE_STALE',
        file,
        line: 0,
        detail: `${key} allows ${n} but only ${got} match — shrink scripts/destructive-gate-baseline.json, the ratchet is shrink-only (#3282)`,
        source: '',
        npmScripts: targets.get(file) ?? [],
      });
    }
  }

  // An allowance without a recorded reason is an allowance nobody reviewed: the
  // whole point of the file is that a human said why this one is tolerable.
  const reasons = baseline._reasons && typeof baseline._reasons === 'object' ? baseline._reasons : {};
  for (const [key, n] of Object.entries(baseline)) {
    if (key === '_comment' || typeof n !== 'number') continue;
    if (reasons[key]) continue;
    findings.push({
      check: 'BASELINE_UNREASONED',
      file: key.split('|')[0],
      line: 0,
      detail: `${key} allows ${n} with no reason in the baseline's "_reasons" object — name why it is tolerated, or gate it (#3282)`,
      source: '',
      npmScripts: targets.get(key.split('|')[0]) ?? [],
    });
  }
  return { notApplicable: false, findings, allowed, hits, targets };
}

export function readBaseline(p) {
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`baseline ${p} is not readable JSON: ${e.message}`);
    return {};
  }
}

/** --update/--print-baseline write what was HIT, never what was filtered out. */
function baselineMap(hits, existing) {
  const counts = {};
  for (const f of hits) {
    const k = `${f.file}|${f.check}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  // A reason travels with its entry and dies with it: leaving a reason behind for an
  // allowance that is gone would read as though the file still tolerated something.
  // It is emitted next to `_comment`, so an entry and its justification are adjacent.
  const kept = existing?._reasons && typeof existing._reasons === 'object'
    ? Object.fromEntries(Object.entries(existing._reasons).filter(([k]) => k in counts))
    : {};
  return {
    _comment: existing?._comment
      ?? '#3282 shrink-only ratchet for scripts/check-destructive-gate.mjs: per-file, per-check count of destructive statements that are known, reviewed and NOT yet gated. Lower a number when you add a --yes/--confirm gate or remove the statement; raising it is a regression. Deleting this file sets every allowance to 0. Every entry needs a reason in _reasons (BASELINE_UNREASONED).',
    ...(Object.keys(kept).length ? { _reasons: kept } : {}),
    ...counts,
  };
}

const EXPLAIN = `destructive-gate screen (#3282) — what each check asserts:
  SCHEMA_WIPE_UNGATED      a DROP SCHEMA / DROP DATABASE literal (needs --yes/--confirm),
                           or CREATE SCHEMA public / GRANT ALL ON SCHEMA (needs any opt-in)
  TABLE_WIPE_UNGATED       a TRUNCATE literal (needs --yes/--confirm) or DROP TABLE (any opt-in)
  UNSCOPED_DELETE_UNGATED  db.delete(table) with no .where(), or DELETE FROM with no WHERE
  BASELINE_STALE           an allowance with no matching site left — shrink-only ratchet
  BASELINE_UNREASONED      an allowance with no reason recorded in the baseline "_reasons"
The reachable set is derived from package.json (scripts running tsx/node on scripts/**),
so an unwired file is out of scope by construction and a wired one cannot hide.
Opt-in vocabulary: --yes, --confirm, --dry-run, NUCRM_ALLOW_ — read from code and string
literals only, never from a comment, because prose cannot stop a run.
`;

export function main(argv = process.argv.slice(2)) {
  const opt = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  if (argv.includes('--explain')) {
    console.log(EXPLAIN);
    return 0;
  }
  const root = path.resolve(opt('--root') ?? ROOT);
  if (!existsSync(path.resolve(root, 'package.json'))) {
    console.error(`destructive gate: no package.json at ${root} — nothing to derive the reachable scripts from`);
    return 2;
  }
  const targets = deriveTargets(root);
  if (!targets || targets.size === 0) {
    console.error(`destructive gate: no package.json script runs a scripts/** file in ${root} — nothing to screen`);
    return 2;
  }
  // A --root changes the baseline too, so a fixture never inherits the repo's
  // allowances: they are per-file, and the whole point is that a file cannot
  // exempt itself by being copied somewhere else.
  const baselineOpt = opt('--baseline');
  const baselinePath = baselineOpt
    ? path.resolve(root, baselineOpt)
    : path.resolve(root, 'scripts', path.basename(DEFAULT_BASELINE));
  let baseline = readBaseline(baselinePath);
  let result = analyse({ root, baseline });

  if (argv.includes('--update') || argv.includes('--print-baseline')) {
    const payload = baselineMap(result.hits, baseline);
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (argv.includes('--update')) {
      writeFileSync(baselinePath, text);
      const entries = Object.keys(payload).filter((k) => typeof payload[k] === 'number');
      console.log(`wrote ${baselinePath} (${entries.length} entries, ${result.hits.length} un-gated destructive statement(s))`);
      const unreasoned = entries.filter((k) => !payload._reasons?.[k]);
      if (unreasoned.length) {
        console.log(`  ${unreasoned.length} allowance(s) still need a reason in "_reasons" (BASELINE_UNREASONED):`);
        for (const k of unreasoned) console.log(`\t  ${k}`);
      }
      return 0;
    }
    console.log(text.trimEnd());
    return 0;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      findings: result.findings,
      allowed: result.allowed,
      hits: result.hits,
      targets: Object.fromEntries(result.targets),
    }, null, 2));
    return result.findings.length ? 1 : 0;
  }

  if (result.findings.length === 0) {
    console.log(`destructive gate: clean — ${result.targets.size} package.json-reachable script(s); every destructive one names an explicit opt-in in its own source, or is reviewed in the baseline (${result.allowed} tolerated)`);
    return 0;
  }
  for (const f of result.findings) {
    console.log(`${f.check}\t${f.file}:${f.line}\t${f.detail}`);
    if (f.source) console.log(`\t  ${f.source}`);
  }
  console.log(`\n${result.findings.length} un-gated destructive statement(s) across ${
    new Set(result.findings.map((f) => f.file)).size} script(s). #3282: nothing here may reach a database without naming the opt-in that lets it — gate it with --yes/--confirm (and a --dry-run), or record it in scripts/destructive-gate-baseline.json with a reason.`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
