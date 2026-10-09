/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2474 — screen the class, not the four instances.
 *
 * `GRANT … ON SCHEMA public TO <role>` is an UPDATE of the single `pg_namespace`
 * row named `public`. `GRANT … ON ALL TABLES IN SCHEMA public` is 226 UPDATEs of
 * `pg_class`. Four integration suites ran both in `beforeAll`, `vitest` spawns a
 * worker per file, and the loser of the resulting race gets
 * `error: tuple concurrently updated` (XX000, `heapam.c:simple_heap_update`) in a
 * file the branch under test had never opened. Repairing four files repairs four
 * files; this screen is what stops a fifth suite from being written that way.
 *
 * WHAT IT LOOKS AT, AND WHY NOT SIMPLY "any GRANT in tests/"
 * ---------------------------------------------------------
 * A test file can *mention* this DDL for reasons that are not the bug:
 * `tests/unit/rls-least-privilege-role.test.ts` asserts that
 * `scripts/provision-app-role.sql` ships `GRANT USAGE ON SCHEMA public TO
 * nucrm_app`, which is correct — provisioning runs once against an empty catalog,
 * where there is nobody to race. And every file in this class documents the
 * statement it forbids: the helper exists to replace it, so the helper *says* it.
 * So the screen reads **string literals** — the SQL a suite actually hands to
 * Postgres — with comments blanked out. The first cut of this screen, which read
 * the raw text, reported seven violations in a tree that had none, three of them
 * in prose explaining the fix.
 *
 * FAILS CLOSED: scanning no files, or finding no helper to point a violator at,
 * is reported as the screen being broken rather than as the suites being clean —
 * the same rule `scripts/check-portal-rls-context.mts` runs by.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER_PATH = 'tests/helpers/rls-probe-role.ts';

/**
 * Object-ACL DDL whose execution writes a catalogue tuple somebody else is
 * writing: `ON SCHEMA <name>`, `ON ALL TABLES IN SCHEMA`, `ON ALL SEQUENCES IN
 * SCHEMA`. Not `ON <table>` — that is one row of one table, and the helper makes
 * it unnecessary anyway, so it is reported as a NOTE rather than a violation.
 */
export const HOT_CATALOG_DDL =
  /\b(?:GRANT|REVOKE)\b[^;]*?\bON\s+(?:ALL\s+(?:TABLES|SEQUENCES)\s+IN\s+SCHEMA|SCHEMA)\b/i;

/**
 * Per-table ACL grants: not the race, but the dependency #2466 could not drop.
 * The object name has to actually start — an `ON ${something}` is a template
 * placeholder, and without that requirement this note rule would match the
 * split-up fixtures in the screen's own unit test.
 */
export const OBJECT_ACL_DDL = /\b(?:GRANT|REVOKE)\b[^;]*?\bON\s+(?!SCHEMA\b|ALL\s)[a-z_][a-z0-9_.]*/i;

const STRING_LITERALS = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/**
 * One pass over a source file that yields its string literals with every comment
 * blanked, indices preserved. Blanking by state machine rather than by regex is
 * what keeps `'https://x'` from reading as a line comment that swallows the rest
 * of the line — and `it's` inside a docblock from reading as a string that
 * swallows the code after it. Both of those are silent-failure directions, which
 * is the only kind of bug a screen of this shape can have.
 */
export function stringLiterals(source) {
  const blanked = source.split('');
  const mode = { kind: 'code', quote: '', inClass: false };
  let lastSignificant = '';

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];

    if (mode.kind === 'block') {
      if (c === '*' && source[i + 1] === '/') {
        blanked[i] = ' ';
        blanked[i + 1] = ' ';
        i += 1;
        mode.kind = 'code';
      } else if (c !== '\n') {
        blanked[i] = ' ';
      }
      continue;
    }
    if (mode.kind === 'line') {
      if (c === '\n') { mode.kind = 'code'; continue; }
      blanked[i] = ' ';
      continue;
    }
    if (mode.kind === 'string') {
      if (c === '\\') { i += 1; continue; }
      if (c === mode.quote) mode.kind = 'code';
      else if (c === '\n' && mode.quote !== '`') mode.kind = 'code';
      continue;
    }
    if (mode.kind === 'regex') {
      if (c === '\n') { mode.kind = 'code'; continue; }
      blanked[i] = ' ';
      if (c === '\\') { i += 1; if (source[i] !== '\n') blanked[i] = ' '; continue; }
      if (c === '[') mode.inClass = true;
      else if (c === ']') mode.inClass = false;
      else if (c === '/' && !mode.inClass) mode.kind = 'code';
      continue;
    }

    if (c === '/' && source[i + 1] === '/') {
      blanked[i] = ' '; blanked[i + 1] = ' '; i += 1; mode.kind = 'line'; continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      blanked[i] = ' '; blanked[i + 1] = ' '; i += 1; mode.kind = 'block'; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      mode.kind = 'string';
      mode.quote = c;
      lastSignificant = c;
      continue;
    }
    if (c === '/' && (lastSignificant === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant))) {
      mode.kind = 'regex';
      mode.inClass = false;
      continue;
    }
    if (!/\s/.test(c)) lastSignificant = c;
  }

  const masked = blanked.join('');
  const out = [];
  for (const match of masked.matchAll(STRING_LITERALS)) {
    out.push({ index: match.index, text: source.slice(match.index, match.index + match[0].length) });
  }
  return out;
}

/** Classify one source file. Pure, so the scanner can be tested without a tree. */
export function findHotCatalogGrants(source) {
  const hot = [];
  const notes = [];
  for (const literal of stringLiterals(source)) {
    const line = source.slice(0, literal.index).split('\n').length;
    const sql = literal.text.slice(0, 120).replace(/\s+/g, ' ');
    if (HOT_CATALOG_DDL.test(literal.text)) hot.push({ line, sql });
    else if (OBJECT_ACL_DDL.test(literal.text) && /\b(GRANT|REVOKE)\b.*\bTO\b/i.test(literal.text)) {
      notes.push({ line, sql });
    }
  }
  return { hot, notes };
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Scan a whole tree from `root`, which must contain `tests/`. */
export function scanTree(root) {
  const scanDir = join(root, 'tests');
  const files = existsSync(scanDir) ? walk(scanDir) : [];
  const violations = [];
  const notes = [];
  for (const file of files) {
    const rel = relative(root, file);
    const { hot, notes: fileNotes } = findHotCatalogGrants(readFileSync(file, 'utf8'));
    for (const hit of hot) violations.push({ where: `${rel}:${hit.line}`, sql: hit.sql });
    for (const hit of fileNotes) notes.push({ where: `${rel}:${hit.line}`, sql: hit.sql });
  }
  return { scanned: files.length, violations, notes };
}

function main() {
  const root = process.cwd();
  const { scanned, violations, notes } = scanTree(root);

  if (scanned === 0) {
    console.error(`FAIL — no TypeScript files found under ${relative(root, join(root, 'tests'))}/`);
    console.error('       A screen that scans nothing proves nothing. Not a pass.');
    process.exit(1);
  }
  if (!existsSync(join(root, HELPER_PATH))) {
    console.error(`FAIL — ${HELPER_PATH} is missing, so there is nowhere to send a violator.`);
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(
      `FAIL — ${violations.length} hot-catalogue GRANT/REVOKE statement(s) in tests/** (#2474):`,
    );
    for (const v of violations) console.error(`  ${v.where}  ${v.sql}`);
    console.error(
      `\nUse ${HELPER_PATH}: mint the probe role and give it pg_read_all_data / ` +
        `pg_write_all_data membership. That writes a fresh pg_auth_members row keyed ` +
        `on the run's own role name, so no two suites can collide, and the role then ` +
        `drops with a bare DROP ROLE because it appears in no object ACL.`,
    );
    process.exit(1);
  }

  console.log(
    `OK — ${scanned} test files scanned, 0 hot-catalogue GRANT/REVOKE statements, ` +
      `${notes.length} per-table ACL note(s)`,
  );
  for (const n of notes) console.log(`  note: ${n.where}  ${n.sql}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
