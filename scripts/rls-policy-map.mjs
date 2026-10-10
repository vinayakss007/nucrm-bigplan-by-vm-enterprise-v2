/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Which row-level-security policies the migration chain LEAVES ON WHICH TABLES.
 *
 * WHY THIS EXISTS (#2516)
 * -----------------------
 * `scripts/check-migration-rls-dml.mjs` has to answer, for one migration: "the
 * rows this file writes — can the connection it runs on actually see them?" The
 * only thing that decides that is the text of the policies on the tables being
 * written (PP-058: `migrate.ts` connects as the tables' owner with
 * FORCE ROW LEVEL SECURITY and no tenant GUC, so a policy-gated write matches
 * ZERO rows while the DDL in the same file still sees the whole heap).
 *
 * Until now the guard asked the question of the FILE ("does this text contain
 * `set_config('app.is_super_admin'`?") and never of the TABLE. That let
 * `0125`'s first draft pass the screen while being RLS-blind for every row it
 * wrote — measured in PP-067 as `UPDATE 0` followed by `ERROR: 23502 … contains
 * null values`, because none of `custom_entities` / `custom_entity_data` /
 * `segment_members` gates on `app.is_super_admin`, while `0109`'s
 * `webhook_events` does. Same marker, opposite outcomes, and the difference
 * lives entirely in `pg_policies`.
 *
 * WHY STATICALLY, NOT FROM THE DATABASE
 * ------------------------------------
 * `pg_policies` is the exact answer and this repo can reach it (`probe-rls.mts`,
 * `rls-policy-shape.mjs` both query it). But a guard that needs a live schema
 * cannot run in the job that catches a bad new migration file: CI's Integration
 * job provisions with `npm run db:sync` (a drizzle push, not the chain) and
 * `scripts/apply-rls-ci.mjs` applies RLS-tagged files as the postgres SUPERUSER,
 * which no policy filters. So this module reads the only corpus that is both
 * complete and version-controlled — `drizzle/migrations/*.sql` — and its output
 * is checked against a real chain build (274 policies over 226 tables, measured
 * on a `db:bootstrap` database; see
 * `tests/unit/migration-rls-policy-map.test.ts`).
 *
 * WHAT MAKES THAT READABLE
 * -----------------------
 * Policies arrive in three shapes, and only the first is a literal statement:
 *
 *   1. `CREATE POLICY "tenant_isolation" ON "webhook_events" FOR ALL USING (…)`
 *      — read directly (0054, 0088, 0090, 0091, 0107, 0115, 0122-0124).
 *   2. `FOREACH t IN ARRAY ARRAY['webhook_queue','dead_letter_queue'] LOOP
 *      EXECUTE format('CREATE POLICY … ON %I …', t)` — the TABLES are a literal
 *      list, so the template can be applied to each name (0015, 0019, 0031,
 *      0092, 0093). The list may also be declared first as
 *      `tables text[] := ARRAY[...]`, which is why `listVars` exists.
 *   3. `FOR rec IN SELECT … FROM pg_attribute WHERE attname = 'tenant_id' LOOP
 *      EXECUTE format('CREATE POLICY …', rec.table_name)` — the target set is a
 *      RUNTIME CATALOGUE RESULT (0037, 0039). No static reader can enumerate it,
 *      and both files wrap their `EXECUTE` in `EXCEPTION WHEN OTHERS THEN RAISE
 *      WARNING`, so a skipped table is invisible by construction. Those events
 *      are kept as *ambient* — recorded, never used as proof.
 *
 * Note the shape of (2)'s format string: Postgres concatenates adjacent
 * literals, so `format('CREATE … USING (' '(a) ' 'OR (b)', t)` is ONE argument.
 * A regex that stops at the second quote sees a truncated template and silently
 * loses the very tables the loop was written for — which is how the first
 * version of this module attributed 22 of the 274 live policies instead of the
 * 177 it now reads. `readSqlString` is why this file has a tokenizer.
 *
 * LAST-WRITER WINS
 * ----------------
 * Postgres has no `CREATE POLICY IF NOT EXISTS`, so nearly every policy-owning
 * file opens with `DROP POLICY IF EXISTS` on the same name it then creates
 * (0088: 72 creates and 84 drops of its own). Resolving the chain therefore
 * means applying events in execution order, keyed on `(table, policyname)`, and
 * letting a drop DELETE rather than merely note. Ignoring drops leaves stale
 * gate text attached to a table whose live policy was rewritten later — the one
 * error direction that would make the guard accept a marker that no longer
 * works, which is the defect being fixed here.
 */

export const TENANT_GUC = 'app.current_tenant';
export const SUPER_ADMIN_GUC = 'app.is_super_admin';

const GUC_RE = /current_setting\(\s*'([\w.]+)'/gi;
const SET_GUC_RE = /set_config\(\s*'([\w.]+)'/gi;

function gucsOf(text) {
  return new Set([...text.matchAll(GUC_RE)].map((m) => m[1].toLowerCase()));
}

/** The GUC names a piece of executable SQL sets — the only marker form in the chain. */
export function setGucs(sql) {
  return new Set([...sql.matchAll(SET_GUC_RE)].map((m) => m[1].toLowerCase()));
}

/**
 * One SQL string constant starting at the opening quote `i`, with `''` as the
 * escape, extended across every ADJACENT literal (Postgres concatenates
 * `'a' 'b'` into one value, and the policy templates of 0031/0092/0093 are
 * written that way). Returns `{ value, end }`, or `null` when the quote never
 * closes — the caller then treats the statement as unreadable rather than
 * partly read.
 */
export function readSqlString(sql, i) {
  if (sql[i] !== "'") return null;
  let value = '';
  let j = i + 1;
  for (;;) {
    if (j >= sql.length) return null;
    if (sql[j] === "'") {
      if (sql[j + 1] === "'") {
        value += "'";
        j += 2;
        continue;
      }
      j++;
      break;
    }
    value += sql[j];
    j++;
  }
  for (;;) {
    const ws = /^\s+/.exec(sql.slice(j));
    if (!ws || sql[j + ws[0].length] !== "'") break;
    const next = readSqlString(sql, j + ws[0].length);
    if (next === null) break;
    value += next.value;
    j = next.end;
  }
  return { value, end: j };
}

/**
 * The argument list of the `(` at `open`, as raw source slices, with string
 * constants and quoted identifiers skipped so a comma inside a template cannot
 * split an argument.
 */
function splitArgs(sql, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      const lit = readSqlString(sql, i);
      if (lit === null) return args;
      i = lit.end - 1;
      continue;
    }
    if (c === '"') {
      const close = sql.indexOf('"', i + 1);
      if (close === -1) return args;
      i = close;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      depth--;
      if (depth === 0) {
        args.push(sql.slice(start, i));
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/** The elements of the first `ARRAY[ … ]` in `text`, in order, lowercased. */
function arrayElements(text) {
  const m = /ARRAY\s*\[/i.exec(text);
  if (!m) return [];
  const body = text.slice(m.index + m[0].length);
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "'") {
      const lit = readSqlString(body, i);
      if (lit === null) break;
      out.push(lit.value.toLowerCase());
      i = lit.end - 1;
      continue;
    }
    if (body[i] === ']') break;
  }
  return out;
}

// An object slot: optionally schema-qualified, optionally quoted, optionally a
// `%I` hole. `%I` is what a template writes, and it is a hole, not a relation.
const OBJ = '(?:"?[\\w$]+"?\\.)?"?([\\w$%]+)"?';
const CREATE_P_RE = new RegExp(
  `CREATE\\s+(?:(?:PERMISSIVE|RESTRICTIVE)\\s+)?POLICY\\s+"?([\\w$%]+)"?\\s+ON\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?${OBJ}`,
  'gi');
const DROP_P_RE = new RegExp(
  `DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?"?([\\w$%]+)"?\\s+ON\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?${OBJ}`,
  'gi');
const FOR_RE = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i;

/** `%I` / `%L` / `%s` in a slot means "filled in at runtime" — nothing to attribute. */
const isHole = (value) => /%[ILs]/.test(value ?? '');
/** The relation named by an object slot, lowercased and unqualified. */
const relationOf = (slot) => slot.toLowerCase().replace(/"/g, '').split('.').pop();

function createEvent(op, rawTable, rawName, text, file, at) {
  const ev = { op, table: relationOf(rawTable), name: rawName.toLowerCase().replace(/"/g, ''), file, at };
  if (op === 'create') {
    ev.cmd = (FOR_RE.exec(text)?.[1] ?? 'all').toLowerCase();
    ev.gucs = gucsOf(text);
    ev.restrictive = /RESTRICTIVE/i.test(text);
  }
  return ev;
}

/**
 * The policy events one migration file performs, in execution order.
 *
 * Shapes 1 and 2 above; shape 3 comes back under `ambient` because its target
 * set is a catalogue result. A file is passed as `{ file, sql }` with `sql`
 * already comment-stripped and limited to its executable scope — prose naming a
 * policy is not a policy, and a stored function body does not run at migration
 * time (both are the PP-058 "the screen read a comment" family).
 */
export function policyEvents({ file = '', sql }) {
  const events = [];
  const ambient = [];

  // shape 1 — literal statements, in textual order
  for (const [re, op] of [[CREATE_P_RE, 'create'], [DROP_P_RE, 'drop']]) {
    for (const m of sql.matchAll(new RegExp(re.source, 'gi'))) {
      const name = m[1];
      const table = m[2];
      if (isHole(name) || isHole(table)) continue;
      const end = sql.indexOf(';', m.index);
      const text = end === -1 ? sql.slice(m.index) : sql.slice(m.index, end + 1);
      events.push(createEvent(op, table, name, text, file, m.index));
    }
  }

  // declared list variables: `tables text[] := ARRAY['leads', …]`
  const listVars = new Map();
  for (const m of sql.matchAll(/([\w$]+)\s+(?:text|varchar|char)?\s*\[\s*\]\s*(?::=|DEFAULT)\s*(ARRAY\s*\[[\s\S]{0,4000}?\]|[\w$]+)/gi)) {
    const els = /^ARRAY/i.test(m[2]) ? arrayElements(m[2]) : [];
    if (els.length > 0) listVars.set(m[1].toLowerCase(), els);
  }

  // shape 2 — FOREACH over a literal ARRAY, template applied to every element
  for (const f of sql.matchAll(/FOREACH\s+([\w$]+)\s+IN\s+ARRAY\s+([\s\S]{0,600}?)\s+LOOP/gi)) {
    const loopVar = f[1].toLowerCase();
    const tail = f[2].trim();
    const list = /^ARRAY/i.test(tail) ? arrayElements(tail) : (listVars.get(tail.toLowerCase()) ?? []);
    // `FOREACH t IN ARRAY <function() result>` is not enumerable; skip rather
    // than guess, so the tables it touches stay `unknown` and conservative.
    if (list.length === 0) continue;
    const bodyStart = f.index + f[0].length;
    const rel = /\bEND\s+LOOP\b/i.exec(sql.slice(bodyStart));
    const body = sql.slice(bodyStart, bodyStart + (rel ? rel.index : 4000));
    // `body` is a slice, so every index found in it has to be put back on the
    // file before it can index `sql` — reading a `format(` at a body-relative
    // offset silently resolves to some other parenthesis, and the templates of
    // 0015/0019/0031/0037/0039/0092/0093 all disappear.
    for (const fm of body.matchAll(/\bformat\s*\(/gi)) {
      const open = bodyStart + fm.index + fm[0].length - 1;
      const args = splitArgs(sql, open);
      if (args.length < 2) continue;
      const lit = readSqlString(args[0].trim(), 0);
      if (lit === null) continue;
      if (!args.slice(1).some((a) => new RegExp(`\\b${loopVar}\\b`, 'i').test(a))) continue;
      const cr = new RegExp(CREATE_P_RE.source, 'i').exec(lit.value);
      const dr = new RegExp(DROP_P_RE.source, 'i').exec(lit.value);
      // The loop var only fills an `%I` hole. A template that hardcodes its
      // relation is not a loop event at all, and shape 1 already saw it.
      const holeInTemplate = (m) => m && /%I/i.test(m[2]);
      for (const table of list) {
        if (cr && holeInTemplate(cr) && !isHole(cr[1])) {
          events.push(createEvent('create', table, cr[1], lit.value, file, f.index));
        }
        if (dr && holeInTemplate(dr) && !isHole(dr[1])) {
          events.push(createEvent('drop', table, dr[1], lit.value, file, f.index));
        }
      }
    }
  }

  // shape 3 — catalogue-driven loop: same template, target set unknown
  for (const f of sql.matchAll(/FOR\s+([\w$]+)(?:\s+[A-Z]+)?\s+IN\s+(SELECT[\s\S]{0,4000}?)\s+LOOP/gi)) {
    const loopVar = f[1].toLowerCase();
    const bodyStart = f.index + f[0].length;
    const rel = /\bEND\s+LOOP\b/i.exec(sql.slice(bodyStart));
    const body = sql.slice(bodyStart, bodyStart + (rel ? rel.index : 6000));
    for (const fm of body.matchAll(/\bformat\s*\(/gi)) {
      const open = bodyStart + fm.index + fm[0].length - 1;
      const args = splitArgs(sql, open);
      if (args.length < 2) continue;
      const lit = readSqlString(args[0].trim(), 0);
      if (lit === null) continue;
      const cr = new RegExp(CREATE_P_RE.source, 'i').exec(lit.value);
      if (!cr || !/%I/i.test(cr[2])) continue;
      if (isHole(cr[1])) continue;
      if (!args.slice(1).some((a) => new RegExp(`(^|[^\\w$])${loopVar}([^\\w$]|$)`, 'i').test(a))) continue;
      ambient.push({
        op: 'create', table: null, name: cr[1].toLowerCase(), file, at: f.index,
        cmd: (FOR_RE.exec(lit.value)?.[1] ?? 'all').toLowerCase(),
        gucs: gucsOf(lit.value),
        restrictive: /RESTRICTIVE/i.test(lit.value),
      });
    }
  }

  // A list loop and a literal statement in the same file are interleaved in
  // textual order, which is the order Postgres runs them.
  events.sort((a, b) => a.at - b.at);
  return { events, ambient };
}

/**
 * The chain's policy state, resolved in file order.
 *
 * `byTable` answers "what does the chain leave on this table"; `ambient` lists
 * the catalogue-driven loops that could have touched any tenant table and are
 * therefore never proof of anything about one of them.
 */
export function resolvePolicyMap(entries) {
  const byTable = new Map();
  const ambient = [];
  const apply = (ev) => {
    if (ev.table === null) {
      ambient.push(ev);
      return;
    }
    let policies = byTable.get(ev.table);
    if (!policies) {
      policies = new Map();
      byTable.set(ev.table, policies);
    }
    if (ev.op === 'drop') policies.delete(ev.name);
    else policies.set(ev.name, ev);
  };
  for (const entry of entries) {
    const seen = policyEvents(entry);
    for (const ev of seen.events) apply(ev);
    for (const ev of seen.ambient) apply(ev);
  }
  return { byTable, ambient };
}

/** Does a policy gate writes of this kind? `FOR ALL` covers every kind. */
export function policyCovers(policy, kind) {
  return policy.cmd === 'all' || policy.cmd === kind;
}

/**
 * The policies that gate a `kind` write into `table`, as the chain leaves them.
 * `unknown: true` means nothing attributable gates that write — shape 3, a name
 * or table written through `%I`, or a policy created outside the migration
 * chain. Callers must treat unknown conservatively.
 */
export function gatingPolicies(map, table, kind) {
  const policies = map.byTable.get(table.toLowerCase());
  if (!policies || policies.size === 0) return { unknown: true, covering: [] };
  const covering = [...policies.values()].filter((p) => policyCovers(p, kind));
  if (covering.length === 0) return { unknown: true, covering: [] };
  return { unknown: false, covering };
}

/**
 * Can a `kind` write into `table` see its rows, given the GUCs the migration
 * sets?
 *
 * Postgres ORs PERMISSIVE policies and ANDs RESTRICTIVE ones, so one admitted
 * policy that the write satisfies is enough — unless a restrictive policy gates
 * on something the file never sets, which denies the row whatever the permissive
 * half allows. `app.current_tenant` short-circuits to ok: every generator in the
 * chain, literal or looped, gates on it, so a migration that establishes the
 * tenant context for each tenant it writes is never the file this guard exists to
 * catch. What it cannot prove is a write whose target rows have NO tenant —
 * `webhook_events` ledger rows are exactly that, which is why `0109` needs the
 * super-admin branch instead, and why the super-admin answer must be per table
 * rather than per file.
 */
export function writeIsVisible(map, table, kind, gucs) {
  const { unknown, covering } = gatingPolicies(map, table, kind);
  if (gucs.has(TENANT_GUC)) return { ok: true, why: 'tenant-guc', unknown };
  if (unknown) {
    return { ok: false, why: 'policy-not-attributable', expected: [TENANT_GUC], seen: [...gucs] };
  }
  const blocked = covering.filter((p) => p.restrictive
    && p.gucs.size > 0 && ![...p.gucs].some((g) => gucs.has(g)));
  if (blocked.length > 0) {
    return { ok: false, why: 'restrictive-policy-gate',
      expected: [...new Set(blocked.flatMap((p) => [...p.gucs]))], seen: [...gucs] };
  }
  const admitted = covering.filter((p) => !p.restrictive);
  const satisfied = admitted.filter((p) => p.gucs.size === 0
    || [...p.gucs].some((g) => gucs.has(g)));
  if (satisfied.length > 0) return { ok: true, why: 'policy-guc', policy: satisfied[0].name };
  return {
    ok: false,
    why: gucs.size === 0 ? 'no-guc-set' : 'guc-not-gated-here',
    expected: [...new Set(admitted.flatMap((p) => [...p.gucs]))].sort(),
    seen: [...gucs],
  };
}
