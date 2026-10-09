/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Shared-catalog DDL screen (#2474).
 *
 * THE CLASS
 * ---------
 * `GRANT <privilege> ON SCHEMA public TO <role>` is not an insert. It is an
 * UPDATE of the single `pg_namespace` row named `public`, so every suite that
 * mints an RLS probe role that way writes the one hot tuple every other suite
 * writes. vitest runs one worker per file, so all of the `beforeAll` blocks land
 * inside the same second. Postgres waits for an in-flight updater, but once the
 * tuple's update chain has moved past the version a waiter read, it raises
 * `XX000 tuple concurrently updated` instead of retrying — a lottery whose odds
 * rise with each added racer. #2474's own casualty was
 * `tests/integration/superadmin-panel-sql.test.ts`, in a CI run of a PR that
 * never edited that file, after four racers had been winning it for weeks.
 *
 * The same mechanism, wider blast, is `GRANT … ON ALL TABLES IN SCHEMA public`:
 * measured on the CI-shaped `nucrm_test`, that statement updates 226 `pg_class`
 * tuples — and it leaves the granted ACLs as dependencies of the role, so
 * `DROP ROLE` then refuses (`#2466`), which is how `DROP OWNED BY` crept in.
 *
 * THE FIX THIS SCREEN PROTECTS
 * ----------------------------
 * `tests/helpers/rls-probe-role-2474.ts` takes privileges from role membership
 * (`GRANT pg_read_all_data / pg_write_all_data TO <run-unique-role>`): each is
 * one fresh `pg_auth_members` row keyed on the caller's own role name, so no two
 * suites touch a common tuple, the role appears in no object ACL, and teardown is
 * one `DROP ROLE`. That is why none of these statements belong in a test again.
 *
 * SCOPE — why "tests/**" needs a discriminator
 * -------------------------------------------
 * The pattern is *correct* SQL elsewhere, and a test file that quotes it is often
 * asserting something about provisioning, not running it:
 * `tests/unit/rls-least-privilege-role.test.ts` regex-matches
 * `GRANT USAGE ON SCHEMA public TO nucrm_app` in the production provisioning SQL,
 * and `tests/unit/integration-rls-restore-2455.test.ts` lists the strings a
 * teardown must NOT contain. Both would be red under a plain `grep -r tests/`.
 * So the screen asks a question that separates the two: does this file reach a
 * database at all? `DB_CONNECTED` looks for the driver import, the pool
 * constructor, the executor call, or the connection-string variable — the things
 * a file that runs DDL necessarily has. A file without any of them cannot execute
 * a statement, so what it contains is prose.
 *
 * Comments are stripped before matching, with a character scanner that tracks
 * string state, because every file in this fix explains the old form by naming
 * it — matching a comment would flag documentation for documenting.
 *
 * SCOPE HONESTY — what this screen does NOT cover
 * ----------------------------------------------
 *   * `tests/**\/*.sql` fixtures executed by `psql` or `db:sync` are not scanned;
 *     nothing under `tests/` is shaped that way today, and adding it would mean
 *     reading the caller, not the file;
 *   * a DB-connected file that builds a statement from fragments
 *     (`'GRANT USAGE ON ' + ns`) reads as nothing to any regex, this one
 *     included; the helper exists so nobody has a reason to;
 *   * `CREATE ROLE`/`DROP ROLE` are allowed on purpose — they write shared
 *     catalogs too, but a fresh `pg_authid` row per run-unique name, so they do
 *     not race. Two *concurrent CI runs* minting the same fixed role name do
 *     collide, and that is a different issue's problem than #2474's tuple;
 *   * the discriminator is a heuristic. A DB-connected test that reaches the
 *     server through a wrapper none of the markers names would be skipped. The
 *     markers cover every shape currently in `tests/`, and the unit test pins the
 *     list so widening it is a deliberate edit.
 *
 * Escape hatch: `// catalog-ddl: allow — <reason>` on the offending line, same
 * convention as the counter ratchet. Baseline is empty by design: any entry must
 * carry a written reason, not a silent grandfather.
 *
 * One file is exempt by a file-level marker instead: the screen's own regression
 * test plants each statement on purpose, and a guard that flags the fixture
 * proving it fires would be a guard nobody can run. The exemption is not silent —
 * `scanTree` reports exempt files and the CLI prints them, so an exemption added
 * elsewhere is visible in every run's output.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, 'tests');

/**
 * A file must be able to reach a database for its SQL text to be a statement.
 * Keep this list and `tests/unit/test-catalog-ddl-screen-2474.test.ts` in step.
 */
export const DB_CONNECTED = [
  /from ['"]pg['"]/,
  /require\(['"]pg['"]\)/,
  /from ['"]postgres['"]/,
  /\bnew Pool\s*\(/,
  /\bcreatePool\s*\(/,
  /\bpool\.(?:query|connect)\b/,
  /\bdb\.execute\s*\(/,
  /\bDATABASE_URL\b/,
];

/** File-level exemption: reported in every run's output, never silent. */
export const FILE_HATCH = 'catalog-ddl: allow-file';

/** Each rule is a write to a catalog tuple somebody else is writing. */
export const RULES = [
  {
    id: 'schema-acl',
    what: 'GRANT/REVOKE … ON SCHEMA <name> UPDATEs the one pg_namespace row for that schema',
    re: /\b(?:GRANT|REVOKE)\b[^;]*\bON\s+SCHEMA\b/i,
  },
  {
    id: 'mass-object-acl',
    what: 'GRANT/REVOKE … ON ALL TABLES|SEQUENCES|FUNCTIONS|PROCEDURES IN SCHEMA UPDATEs one pg_class row per object',
    re: /\b(?:GRANT|REVOKE)\b[^;]*\bON\s+ALL\s+(?:TABLES|SEQUENCES|FUNCTIONS|PROCEDURES)\b/i,
  },
  {
    id: 'default-privileges',
    // Before `object-acl`: `ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO x`
    // is also textually an object grant, and the precise diagnosis is the one
    // that explains the pg_default_acl write.
    what: 'ALTER DEFAULT PRIVILEGES writes pg_default_acl and re-shapes every later object in the shared database',
    re: /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i,
  },
  {
    id: 'drop-owned',
    what: 'DROP OWNED BY is the cascade that a suite only needs because it left object ACLs behind',
    re: /\bDROP\s+OWNED\s+BY\b/i,
  },
  {
    id: 'object-acl',
    what: 'GRANT/REVOKE … ON <object> UPDATEs that object pg_class row, and leaves an ACL dependency DROP ROLE cannot pass (#2466)',
    re: /\b(?:GRANT|REVOKE)\b[^;]*\bON\s+(?!SCHEMA\b|ALL\b)[A-Za-z_"][\w."$]*[^;]*\b(?:TO|FROM)\b/i,
  },
];

/** Blank out line comments and block comments, keeping line/character offsets. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let state = 'code'; // code | line | block | squote | dquote | template
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === "'") state = 'squote';
      else if (c === '"') state = 'dquote';
      else if (c === '`') state = 'template';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      } else {
        out += ' ';
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // Inside a string literal the text is data: keep it, but do not let a `//`
    // in a URL or a quoted `/*` end the literal early.
    const quote = state === 'squote' ? "'" : state === 'dquote' ? '"' : '`';
    if (c === '\\') {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === quote) state = 'code';
    if (state === 'code' && c === '\n') {
      // A newline inside a template literal is still inside the string, but the
      // offset bookkeeping below keeps lines aligned either way.
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(name)) yield p;
  }
}

/** All violations in one source string. `file` is only used for markers. */
export function scanSource(src) {
  const connected = DB_CONNECTED.some(re => re.test(src));
  if (src.includes(FILE_HATCH)) return { connected, violations: [], exempt: true };
  const code = stripComments(src);
  if (!connected) return { connected: false, violations: [], exempt: false };
  const violations = [];
  const lines = code.split('\n');
  const rawLines = src.split('\n');
  lines.forEach((line, idx) => {
    const hatchLine = rawLines[idx] ?? '';
    if (hatchLine.includes('catalog-ddl: allow')) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        violations.push({
          line: idx + 1,
          rule: rule.id,
          what: rule.what,
          text: line.trim().slice(0, 120),
        });
        return;
      }
    }
  });
  return { connected, violations, exempt: false };
}

export function scanTree(scanDir = SCAN_DIR) {
  const findings = [];
  const exempt = [];
  let files = 0;
  let dbConnectedFiles = 0;
  for (const file of walk(scanDir)) {
    files++;
    const { connected, violations, exempt: isExempt } = scanSource(readFileSync(file, 'utf8'));
    if (connected) dbConnectedFiles++;
    if (isExempt) exempt.push(relative(ROOT, file));
    for (const v of violations) findings.push({ file: relative(ROOT, file), ...v });
  }
  return { findings, exempt, files, dbConnectedFiles };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, exempt, files, dbConnectedFiles } = scanTree();
  if (findings.length > 0) {
    console.error(`[check-test-catalog-ddl] ${findings.length} shared-catalog DDL statement(s) in ${dbConnectedFiles} database-connected test file(s):`);
    for (const f of findings) {
      console.error(`  - ${f.file}:${f.line} [${f.rule}] ${f.text}`);
      console.error(`      ${f.what}`);
    }
    console.error('Mint the probe with tests/helpers/rls-probe-role-2474.ts — privileges from role ' + 'membership write no shared tuple. See #2474.');
    process.exit(1);
  }
  const note = exempt.length > 0 ? `; exempt by file marker: ${exempt.join(', ')}` : '';
  console.log(`[check-test-catalog-ddl] OK — ${files} files scanned, ${dbConnectedFiles} database-connected, 0 shared-catalog DDL statements${note}.`);
}
