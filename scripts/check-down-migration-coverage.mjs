#!/usr/bin/env node
/**
 * #3284 — down-migration coverage.
 *
 * Every forward migration ships (or should ship) a `.down.sql`, `package.json`
 * advertises `db:rollback`, and `db:rollback:coverage` already answers one question
 * about that path: does a rollback *file* exist. It does not ask whether the file can
 * run, or whether it deletes the right things — and those are the questions that decide
 * whether a release manager pressing rollback gets their schema back or gets a
 * partially-rolled-back schema plus a stack of dependency errors. `guard:chain`,
 * `guard:migration-redecl` and `guard:migration-rls` all read the forward direction
 * only, so nothing screened the rollback path at PR time. This does, statically, with no
 * database and no credentials.
 *
 * Checks, in the order they run:
 *
 *   NO_ROLLBACK     a journal entry with no `.down.sql` at all. `verifyRollbackCoverage`
 *                   counts these; this fails the build on them, because a migration that
 *                   cannot be rolled back should not be merged without saying so.
 *   DEAD_RELATION   a constraint drop whose relation a later up dropped and no later down
 *                   brings back. `ALTER TABLE x DROP CONSTRAINT IF EXISTS y` still errors
 *                   when `x` is gone — IF EXISTS guards the constraint, not the relation.
 *   DEAD_CONSTRAINT a constraint drop whose relation a later up drops and a later down
 *                   recreates *structure only*. The recreated table has no such constraint,
 *                   so the name is already gone when this runs: without `IF EXISTS` the
 *                   statement aborts the rollback, with it the script silently does
 *                   nothing and the constraint survives the rollback it belongs to.
 *   FOREIGN_OBJECT  a down script that removes a constraint a *later* up created — the
 *                   half of the #3284 ask that would have caught it at review. A
 *                   `conname LIKE` loop is expanded against every name any up creates, so
 *                   `LIKE 'chk_%'` is reported as the width it has, not the intent its
 *                   comment claims; `conname IN (…)` lists are read name by name.
 *   HELPER_HELD     a down that drops a function while a later up's CHECK constraint
 *                   still calls it and that later down cannot deliver the removal — the
 *                   2BP01 that aborts 0051's rollback.
 *   OPERATOR_PRECEDENCE a dynamic delete whose `WHERE contype = 'c' AND conname LIKE a
 *                   OR conname LIKE b` mixes AND with OR without parentheses, so the
 *                   second branch is unfiltered and the loop's reach is wider than it
 *                   intends.
 *   NOT_OWNED       a constraint an up creates that its own down never removes — not by
 *                   name, not by an `IN` list or `LIKE` pattern that matches it, not by
 *                   `DROP TABLE` of its relation, not by `DROP COLUMN` of a column it is
 *                   defined on. This is the only *baselined* check: 242 of these are
 *                   already in the tree (drizzle-generated downs for early schema
 *                   migrations, and `0002_flat_sir_ram.down.sql`, which is a `SELECT 1`
 *                   stub), so the ratchet is per-migration counts, shrink-only, and a new
 *                   one fails. Fixing any of them prints a hint to shrink the baseline.
 *
 * The rollback model this screens against is the reverse-order sweep: journal order is
 * apply order, so a rollback runs the newest `.down.sql` first. That is the only order in
 * which a shared helper can ever be dropped safely, and it is what #3284 ask 1 asks for.
 * Statements wrapped in a `pg_class WHERE relname = …` or `to_regclass(…)` existence test
 * are credited as handling their own absence, which is how `0076_ondelete_rules.down.sql`
 * survives the same shape.
 *
 * What it cannot see, and does not claim to: only `ALTER TABLE … ADD CONSTRAINT` is
 * parsed, so a constraint written inline in `CREATE TABLE` is invisible to NOT_OWNED and
 * FOREIGN_OBJECT (a false negative, never a false accusation); a dynamic loop is screened
 * only through its `conname LIKE` / `conname IN` clauses, so a loop keyed on anything else
 * is unmeasured; `DROP TABLE … CASCADE` is credited with removing that table's constraints
 * without asking whether something outside the table depends on them; the `;` split that
 * recovers a CHECK's text truncates a clause containing a semicolon inside a string
 * literal, which again loses findings rather than inventing them; column and index
 * coverage is not asserted, which is narrower than #3284 ask 3 describes; and nothing here
 * reads a live catalog — `scripts/rls-policy-shape.mjs` stays the live-DB sweep. This
 * guard's job is to make the static shape of a rollback statement fail review, the way the
 * other three migration guards do.
 *
 * Flags, for the sake of the fixture test:
 *   --migrations-dir <dir>  read another tree than drizzle/migrations
  const known = [...owned.values()].reduce((a, n) => a + n.length, 0);
  console.log(`(NOT_OWNED ratchet: ${known} across ${owned.size} migrations, allowed by ${rel(baselinePath)})`);
 *   --update                rewrite that baseline with the current counts, then re-report
 *   --print-baseline        print the map a clean tree would need, and exit 0
 *   --explain               print this check catalogue and exit 0
 *
 * Exit 0 prints a single `clean across N migrations` line; each finding is printed as
 * `CHECK file detail` and the process exits 1.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MIGRATIONS_DIR = 'drizzle/migrations';
const DEFAULT_BASELINE_PATH = 'scripts/down-migration-coverage-baseline.json';

const re = (body, flags = 'gi') => new RegExp(body, flags);

/** A quoted or bare lowercase identifier, capture 1. */
const ID = '"?([a-z_][a-z0-9_]*)"' + '?';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** Print a path relative to the repo when it is inside it, absolute otherwise. */
const rel = (p) => (p.startsWith(ROOT + '/') ? p.slice(ROOT.length + 1) : p);

/** Journal order is the apply order, and therefore the reverse-order rollback. */
export function migrationOrder(dir) {
  return JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')).entries.map((e) => e.tag);
}

/**
 * One entry per `ALTER TABLE … ADD CONSTRAINT …` statement, carrying the relation, the
 * kind and the statement text — so a helper called inside a CHECK expression is
 * attributable to that constraint rather than to whichever line of the file mentions it.
 */
function constraintClauses(text, tag) {
  const out = [];
  for (const stmt of text.split(';')) {
    const m = stmt.match(
      /ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+ADD CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?/i,
    );
    if (!m) continue;
    const kind = /\bCHECK\b/i.test(stmt) ? 'check'
      : /\bFOREIGN KEY\b|\bREFERENCES\b/i.test(stmt) ? 'fk'
        : /\bPRIMARY KEY\b/i.test(stmt) ? 'pk'
          : /\bUNIQUE\b/i.test(stmt) ? 'unique' : 'other';
    out.push({ table: m[1], name: m[2], kind, clause: stmt.trim(), tag });
  }
  return out;
}

/** What each up creates, plus which relation each up removes. */
export function buildForwardFacts(order, dir) {
  const facts = new Map();
  for (const tag of order) {
    const text = read(join(dir, `${tag}.sql`)) ?? '';
    facts.set(tag, {
      text,
      constraints: constraintClauses(text, tag),
      tables: [...text.matchAll(re(`CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${ID}`, 'gi'))].map((m) => m[1]),
      droppedTables: [...text.matchAll(re(`DROP TABLE (?:IF EXISTS )?(?:public\\.)?${ID}`, 'gi'))].map((m) => m[1]),
    });
  }
  return facts;
}

/** `--` line comments are prose, not SQL: the guard must not read a pattern out of one. */
const stripComments = (text) => text.replace(/--[^\n]*/g, '');

/** Everything a down script names: relation-scoped drops, function drops, loops, guards. */
export function parseDown(tag, dir) {
  const raw = read(join(dir, `${tag}.down.sql`));
  if (raw === null) return null;
  const text = stripComments(raw);
  const out = {
    tag, text, alterConstraint: [], dropFunction: [], dropTable: [],
    dropColumn: [], createTable: [], addConstraint: [], patterns: [], inList: [], guardedTables: [],
  };
  for (const m of text.matchAll(re(`ALTER TABLE ${ID} DROP CONSTRAINT (IF EXISTS )?${ID}`, 'gi'))) {
    out.alterConstraint.push({ table: m[1], name: m[3], ifExists: !!m[2] });
  }
  for (const m of text.matchAll(re(`ALTER TABLE ${ID} DROP COLUMN (IF EXISTS )?${ID}`, 'gi'))) {
    out.dropColumn.push({ table: m[1], column: m[3] });
  }
  for (const m of text.matchAll(re(`ALTER TABLE ${ID} ADD CONSTRAINT ${ID}`, 'gi'))) out.addConstraint.push(m[2]);
  for (const m of text.matchAll(re(`DROP FUNCTION (?:IF EXISTS )?(?:public\\.)?${ID}(\\([^)]*\\))?`, 'gi'))) {
    out.dropFunction.push(m[1]);
  }
  for (const m of text.matchAll(re(`DROP TABLE (?:IF EXISTS )?(?:public\\.)?${ID}`, 'gi'))) out.dropTable.push(m[1]);
  for (const m of text.matchAll(re(`CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${ID}`, 'gi'))) out.createTable.push(m[1]);
  for (const m of text.matchAll(re(`conname\\s+LIKE\\s+'([^']+)'`, 'gi'))) out.patterns.push(m[1]);
  for (const m of text.matchAll(re(`conname\\s+IN\\s*\\(([^)]*)\\)`, 'gi'))) {
    for (const n of m[1].matchAll(/'([a-z_][a-z0-9_]*)'/gi)) out.inList.push(n[1]);
  }
  // `IF EXISTS (SELECT 1 FROM pg_class WHERE relname='x')` / `to_regclass('x')` — the
  // script asks whether the relation is there before naming it.
  for (const m of text.matchAll(re(`pg_class\\s+WHERE\\s+relname\\s*=\\s*'([a-z_][a-z0-9_]*)'`, 'gi'))) out.guardedTables.push(m[1]);
  for (const m of text.matchAll(re(`to_regclass\\('(?:public\\.)?([a-z_][a-z0-9_.]*)'`, 'gi'))) out.guardedTables.push(m[1]);
  return out;
}

/** SQL LIKE (`%`/`_`) to an anchored RegExp, so a loop's reach can be measured. */
export function likeToRegExp(like) {
  const esc = like.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`);
}

/**
 * 0051's dynamic delete is `WHERE contype='c' AND conname LIKE … OR conname LIKE …` —
 * `AND` binds tighter, so the second branch is not restricted to CHECK constraints.
 * Cheap, textual, and specific enough not to fire on a correctly parenthesised loop.
 */
export function unparenthesisedAndOr(text) {
  return /WHERE\s+[^;()]*\bAND\b[^;()]*\bOR\b[^;()]*\bLIKE\b/i.test(text);
}

export function readBaseline(baselinePath) {
  const raw = read(baselinePath);
  if (raw === null) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/** The map a clean tree would need, for `--print-baseline` and `--update`. */
export function baselineMap(owned) {
  const out = {};
  for (const [tag, names] of owned) if (names.length > 0) out[tag] = names.length;
  return out;
}

export function analyse({ dir = join(ROOT, DEFAULT_MIGRATIONS_DIR), baseline = {} } = {}) {
  const order = migrationOrder(dir);
  const facts = buildForwardFacts(order, dir);
  const pos = new Map(order.map((t, i) => [t, i]));
  const downs = new Map();
  for (const tag of order) {
    const d = parseDown(tag, dir);
    if (d) downs.set(tag, d);
  }

  // Every constraint name any up creates, with its owner and relation: the universe a
  // `conname LIKE` pattern or `conname IN` list in a down script can reach.
  const createdBy = new Map();
  for (const c of [...facts.values()].flatMap((f) => f.constraints)) if (!createdBy.has(c.name)) createdBy.set(c.name, c);

  const findings = [];
  const push = (check, file, detail) => findings.push({ check, file, detail });

  /** Does this down remove the constraint, by any of the five honest routes? */
  const removes = (d, c) =>
    d.alterConstraint.some((a) => a.name === c.name) ||
    d.inList.includes(c.name) ||
    d.patterns.some((p) => likeToRegExp(p).test(c.name)) ||
    d.dropTable.includes(c.table) ||
    d.dropColumn.some((c2) => c2.table === c.table && new RegExp(`\\b${c2.column}\\b`, 'i').test(c.clause));

  // 1. NO_ROLLBACK
  for (const tag of order) {
    if (downs.has(tag)) continue;
    push('NO_ROLLBACK', `${tag}.sql`, `the journal ships no ${tag}.down.sql, so this migration cannot be rolled back at all`);
  }

  // 2. DEAD_RELATION / DEAD_CONSTRAINT — what the schema actually looks like when this
  //    statement runs, given that every down at a later position has already run.
  const laterDownCreates = (table, i) =>
    order.slice(i + 1).filter((t) => downs.get(t)?.createTable.includes(table) ?? false);
  const laterDownReadds = (name, i) =>
    order.slice(i + 1).filter((t) => downs.get(t)?.addConstraint.includes(name) ?? false);

  for (const [tag, d] of downs) {
    const i = pos.get(tag);
    for (const a of d.alterConstraint) {
      if (d.guardedTables.includes(a.table)) continue; // it asks first whether the relation is there
      const droppedBy = order.slice(i + 1).find((t) => facts.get(t).droppedTables.includes(a.table));
      if (!droppedBy) continue;
      const recreatedBy = laterDownCreates(a.table, i);
      if (recreatedBy.length === 0) {
        push('DEAD_RELATION', `${tag}.down.sql`,
          `ALTER TABLE ${a.table} DROP CONSTRAINT ${a.ifExists ? 'IF EXISTS ' : ''}${a.name} — ${a.table} is dropped by ${droppedBy}, which is applied BEFORE this rollback runs and no later down brings it back, so the statement aborts on a missing relation (IF EXISTS guards the constraint name, not the table)`);
        continue;
      }
      if (a.ifExists || laterDownReadds(a.name, i).length > 0) continue;
      const rebuilder = recreatedBy.map((t) => `${t}.down.sql`).join(' and ');
      push('DEAD_CONSTRAINT', `${tag}.down.sql`,
        `ALTER TABLE ${a.table} DROP CONSTRAINT ${a.name} — ${droppedBy}.sql drops ${a.table} and ${rebuilder} recreates it structure only, without ${a.name}, so the constraint is already absent when this runs and the unguarded drop aborts the rollback on a missing name`);
    }
  }

  // 3. FOREIGN_OBJECT — a down reaching for a constraint a later up created.
  for (const [tag, d] of downs) {
    const i = pos.get(tag);
    const byName = [];
    const byPattern = new Map(); // pattern -> Map(owner -> count)
    for (const c of createdBy.values()) {
      if (pos.get(c.tag) <= i) continue;
      if (d.alterConstraint.some((a) => a.name === c.name) || d.inList.includes(c.name)) {
        byName.push(`${c.name} (created by ${c.tag})`);
      }
      for (const p of d.patterns) {
        if (!likeToRegExp(p).test(c.name)) continue;
        if (!byPattern.has(p)) byPattern.set(p, new Map());
        const owners = byPattern.get(p);
        owners.set(c.tag, (owners.get(c.tag) ?? 0) + 1);
      }
    }
    for (const h of byName) {
      push('FOREIGN_OBJECT', `${tag}.down.sql`, `it drops ${h} by name — a rollback of this migration alone deletes a guardrail that migration owns`);
    }
    for (const [p, owners] of byPattern) {
      const total = [...owners.values()].reduce((a, b) => a + b, 0);
      const list = [...owners].sort().map(([o, n]) => `${n} from ${o}`).join(', ');
      push('FOREIGN_OBJECT', `${tag}.down.sql`,
        `its loop matches conname LIKE '${p}', which reaches ${total} constraint(s) created by LATER migrations (${list}). A pattern that broad cannot be scoped by what this migration owns — name the names, or scope the loop by the table this migration touched.`);
    }
  }

  // 4. HELPER_HELD — dropping a function a later up's CHECK still calls, when that
  //    later down cannot deliver the removal.
  const blocked = new Set(findings.filter((f) => f.check === 'DEAD_RELATION' || f.check === 'DEAD_CONSTRAINT').map((f) => f.file));
  for (const [tag, d] of downs) {
    const i = pos.get(tag);
    for (const fn of d.dropFunction) {
      const callers = new Map(); // owner tag -> [constraint names]
      for (const c of createdBy.values()) {
        if (c.kind !== 'check' || pos.get(c.tag) <= i) continue;
        if (!new RegExp(`\\b${fn}\\s*\\(`, 'i').test(c.clause)) continue;
        if (!callers.has(c.tag)) callers.set(c.tag, []);
        callers.get(c.tag).push(c.name);
      }
      const shown = (names) => `${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}`;
      for (const [owner, names] of callers) {
        const ownerDown = downs.get(owner);
        const cleans = ownerDown !== undefined && names.every((n) => removes(ownerDown, createdBy.get(n)));
        if (!cleans) {
          push('HELPER_HELD', `${tag}.down.sql`,
            `DROP FUNCTION ${fn} runs while ${owner} adds ${names.length} CHECK constraint(s) calling it (${shown(names)}) and ${owner}.down.sql does not remove them — 2BP01 depends_on_objects`);
        } else if (blocked.has(`${owner}.down.sql`)) {
          push('HELPER_HELD', `${tag}.down.sql`,
            `DROP FUNCTION ${fn} runs while ${owner}'s ${names.length} CHECK constraint(s) still call it (${shown(names)}): ${owner}.down.sql names them but cannot run (see its DEAD_RELATION/DEAD_CONSTRAINT finding), so the dependency is still there — 2BP01`);
        }
      }
    }
  }

  // 5. OPERATOR_PRECEDENCE — a dynamic delete whose WHERE mixes AND with OR bare.
  for (const [tag, d] of downs) {
    if (unparenthesisedAndOr(d.text)) {
      push('OPERATOR_PRECEDENCE', `${tag}.down.sql`,
        "the dynamic-delete WHERE reads contype = 'c' AND conname LIKE a OR conname LIKE b without parentheses, so the second LIKE branch is not restricted to CHECK constraints");
    }
  }

  // 6. NOT_OWNED, against the per-migration ratchet.
  const owned = new Map();
  for (const [tag, d] of downs) {
    for (const c of facts.get(tag)?.constraints ?? []) {
      if (removes(d, c)) continue;
      if (!owned.has(tag)) owned.set(tag, []);
      owned.get(tag).push(`${c.name} on ${c.table}`);
    }
  }
  const baselineSlack = [];
  for (const [tag, names] of owned) {
    const allowed = baseline[tag] ?? 0;
    if (names.length > allowed) {
      for (const n of names.slice(0, names.length - allowed)) {
        push('NOT_OWNED', `${tag}.sql`, `${n} is created here but ${tag}.down.sql never removes it (baseline allows ${allowed})`);
      }
    } else if (names.length < allowed) {
      baselineSlack.push(`${tag}: ${allowed} -> ${names.length}`);
    }
  }
  return { findings, order, downs, facts, createdBy, owned, baselineSlack };
}

const EXPLAIN = `down-migration coverage (#3284) — what each check asserts:
  NO_ROLLBACK          the journal has an entry with no .down.sql
  DEAD_RELATION        a constraint drop whose relation is gone and never rebuilt
  DEAD_CONSTRAINT      a constraint drop whose relation is rebuilt without that constraint
  FOREIGN_OBJECT       a down deleting a constraint a LATER migration owns
  HELPER_HELD          a function drop while a later CHECK still calls it
  OPERATOR_PRECEDENCE  a dynamic delete whose AND/OR mix widens the loop
  NOT_OWNED            a constraint an up adds that its own down never removes (baselined)
`;

export function main(argv = process.argv.slice(2)) {
  const opt = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const dir = resolve(ROOT, opt('--migrations-dir') ?? DEFAULT_MIGRATIONS_DIR);
  const baselinePath = resolve(ROOT, opt('--baseline') ?? DEFAULT_BASELINE_PATH);
  if (!existsSync(join(dir, 'meta', '_journal.json'))) {
    console.error(`no _journal.json under ${dir}`);
    return 2;
  }

  if (argv.includes('--explain')) {
    console.log(EXPLAIN);
    return 0;
  }

  let baseline = readBaseline(baselinePath);
  let { findings, order, owned, baselineSlack } = analyse({ dir, baseline });

  if (argv.includes('--print-baseline')) {
    console.log(JSON.stringify(baselineMap(owned), null, 2));
    return 0;
  }
  if (argv.includes('--update')) {
    const next = { _comment: 'Shrink-only ratchet for scripts/check-down-migration-coverage.mjs: per-migration count of constraints an up adds that its own down never removes. Lower a number when you fix one; deleting this file sets every allowance to 0.', ...baselineMap(owned) };
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`wrote ${baselinePath} (${Object.keys(next).length - 1} entries)`);
    baseline = readBaseline(baselinePath);
    ({ findings, order, owned, baselineSlack } = analyse({ dir, baseline }));
  }

  if (findings.length === 0) {
    console.log(`down-migration coverage: clean across ${order.length} migrations`);
    for (const s of baselineSlack) console.log(`baseline can shrink — ${s}`);
    return 0;
  }
  for (const f of findings) console.log(`${f.check.padEnd(20)} ${f.file}  ${f.detail}`);
  console.log(`\n${findings.length} rollback defect(s) found across ${order.length} migrations.`);
  for (const s of baselineSlack) console.log(`baseline can shrink — ${s}`);
  const known = [...owned.values()].reduce((a, n) => a + n.length, 0);
  console.log(`(NOT_OWNED ratchet: ${known} across ${owned.size} migrations, allowed by ${rel(baselinePath)})`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
