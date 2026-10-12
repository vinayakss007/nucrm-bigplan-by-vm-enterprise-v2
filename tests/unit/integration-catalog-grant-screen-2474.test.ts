/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2474 — the scanner that keeps `tests/**` off the hot catalog tuples.
 *
 * WHY THIS IS TESTED AND NOT JUST RUN
 * -----------------------------------
 * A screen whose only failure mode is silence is a screen that has already
 * failed. `scripts/check-integration-catalog-grants.mjs` reads string literals
 * with the comments blanked, and every one of those two halves can break in a
 * direction that reports green:
 *
 *   - blank too little and prose is policed. The first cut did exactly that: the
 *     raw text scan found seven violations in a tree that had none, because every
 *     file in this class *documents* the statement it forbids — three of the
 *     seven were in `tests/helpers/rls-probe-role.ts`, whose whole purpose is to
 *     replace `GRANT USAGE ON SCHEMA public`.
 *   - blank too much and the DDL goes unnoticed. An apostrophe in a comment that
 *     opens a phantom string, or the `//` inside `'https://…'` opening a phantom
 *     line comment, each silently deletes the code that follows it.
 *
 * So both directions are pinned here against synthesized sources, and the real
 * tree is pinned as well — with a floor on how many files were read, because
 * "0 offenders" from a scan of 0 files is the same green.
 *
 * The DDL strings below are assembled from pieces. This file lives in `tests/**`,
 * so it is scanned by the very screen it tests, and one literal containing a
 * whole `GRANT … ON SCHEMA public` would make the guard's own unit test its
 * newest violation. That is the screen working, not a trick to dodge it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  HELPER_PATH,
  HOT_CATALOG_DDL,
  OBJECT_ACL_DDL,
  stringLiterals,
  findHotCatalogGrants,
  scanTree,
} from '../../scripts/check-integration-catalog-grants.mjs';

const SCHEMA_KW = 'SCH' + 'EMA';
const ALL_KW = 'TA' + 'BLES';

/** A suite in the shape that raced: DDL handed to Postgres in a template literal. */
const racingSuite = (target = 'probe_role') =>
  [
    "const pool = new Pool({ connectionString: process.env.DATABASE_URL });",
    `await pool.query(\`CREATE ROLE ${target} NOSUPERUSER NOBYPASSRLS NOINHERIT;\`);`,
    `await pool.query(\`GRANT USAGE ON ${SCHEMA_KW} public TO ${target}\`);`,
    `await pool.query(\`GRANT SELECT ON ALL ${ALL_KW} IN ${SCHEMA_KW} public TO ${target}\`);`,
  ].join('\n');

describe('#2474 — the hot-catalogue DDL rule', () => {
  it('names the statement that UPDATEs the pg_namespace row', () => {
    const { hot } = findHotCatalogGrants(racingSuite());
    // With the delimiters: the pair of (index, text) is what a violation is
    // reported from, so the scanner never rewrites the SQL it found.
    expect(hot.map((h) => h.sql)).toEqual([
      `\`GRANT USAGE ON ${SCHEMA_KW} public TO probe_role\``,
      `\`GRANT SELECT ON ALL ${ALL_KW} IN ${SCHEMA_KW} public TO probe_role\``,
    ]);
  });

  it('names the teardown form, because restoring a schema ACL is the same UPDATE', () => {
    const source = `await pool.query('REVOKE USAGE ON ${SCHEMA_KW} public FROM probe_role');`;
    expect(findHotCatalogGrants(source).hot).toHaveLength(1);
  });

  it('names it whatever case the author used', () => {
    const source = `await pool.query('grant usage on ${SCHEMA_KW} PUBLIC to probe_role');`;
    expect(findHotCatalogGrants(source).hot).toHaveLength(1);
  });

  it('reports a per-table grant as a note, not as the race', () => {
    // `ON <table>` writes one row of one pg_class entry — not the shared tuple.
    // It is still the dependency #2466 could not drop, so it is said out loud.
    // A fixture that trips this rule does appear in the nightly note list, which
    // is the channel proving it works: notes are reported, never fatal.
    const { hot, notes } = findHotCatalogGrants(
      `await pool.query('GRANT SELECT, INSERT ON fixture_table TO probe_role');`,
    );
    expect(hot).toHaveLength(0);
    expect(notes).toHaveLength(1);
  });

  it('does not name the membership form this screen exists to send people to', () => {
    const source = [
      `await pool.query('CREATE ROLE probe_role NOSUPERUSER NOBYPASSRLS INHERIT;');`,
      `await pool.query('GRANT pg_read_all_data TO probe_role');`,
      `await pool.query('GRANT pg_write_all_data TO probe_role');`,
    ].join('\n');
    const { hot, notes } = findHotCatalogGrants(source);
    expect(hot).toHaveLength(0);
    expect(notes).toHaveLength(0);
  });

  it('the two regexes cannot both match the same shape', () => {
    // HOT is checked first; if OBJECT_ACL also matched a schema grant the note
    // list would double-count, and the "N note(s)" line would stop meaning
    // "per-table grants".
    const schema = `'GRANT USAGE ON ${SCHEMA_KW} public TO x'`;
    expect(HOT_CATALOG_DDL.test(schema)).toBe(true);
    expect(OBJECT_ACL_DDL.test(schema)).toBe(false);
  });

  it('does not mistake a template placeholder for an object name', () => {
    // Every fixture in this file is assembled that way, so the screen would
    // otherwise spend its note list describing its own unit test.
    expect(OBJECT_ACL_DDL.test(`'GRANT SELECT ON \${tbl} TO x'`)).toBe(false);
  });
});

describe('#2474 — comments are prose, not code', () => {
  it('does not police the DDL a file documents in order to forbid it', () => {
    const prose = `the helper replaces GRANT USAGE ON ${SCHEMA_KW} public with role membership`;
    const source = `/**\n * ${prose}\n */\nconst sql = 'SELECT 1';\n`;
    expect(findHotCatalogGrants(source).hot).toHaveLength(0);
    expect(findHotCatalogGrants(source).notes).toHaveLength(0);
  });

  it('does not police a line comment', () => {
    const source = `// GRANT USAGE ON ${SCHEMA_KW} public is what raced\nawait pool.query('SELECT 1');`;
    expect(findHotCatalogGrants(source).hot).toHaveLength(0);
  });

  it('still polices code that follows an apostrophe in prose', () => {
    // `it's` must not open a phantom string that swallows the rest of the file.
    const source = [
      "// it's a shared tuple, so nobody else can be writing it",
      `await pool.query('GRANT USAGE ON ${SCHEMA_KW} public TO probe_role');`,
    ].join('\n');
    expect(findHotCatalogGrants(source).hot).toHaveLength(1);
  });

  it('still polices code that follows a URL in a string', () => {
    // `//` inside a literal must not start a phantom line comment.
    const source = [
      `const docs = 'https://postgresql.org/docs/ddl.html';`,
      `await pool.query('GRANT USAGE ON ${SCHEMA_KW} public TO probe_role');`,
    ].join('\n');
    expect(findHotCatalogGrants(source).hot).toHaveLength(1);
  });

  it('does not police DDL written as a regular expression', () => {
    // The detector's own pattern, and any test fixture that greps for it.
    const source = `const re = /GRANT USAGE ON ${SCHEMA_KW} public/g;`;
    expect(findHotCatalogGrants(source).hot).toHaveLength(0);
  });
});

describe('#2474 — stringLiterals reads literals, not the whole file', () => {
  it('hands back the original text at the original index', () => {
    const source = `const a = 'one';\nconst b = "GRANT SELECT ON analytics_events";\nconst c = \`three\`;`;
    const found = stringLiterals(source);
    expect(found.map((f) => f.text)).toEqual([`'one'`, `"GRANT SELECT ON analytics_events"`, `\`three\``]);
    for (const literal of found) {
      expect(source.slice(literal.index, literal.index + literal.text.length)).toBe(literal.text);
    }
  });

  it('keeps a template placeholder inside the literal it is in', () => {
    const source = 'await pool.query(`GRANT ${privilegeRole} TO "probe"`);';
    const found = stringLiterals(source);
    expect(found).toHaveLength(1);
    expect(found[0].text).toContain('${privilegeRole}');
  });

  it('survives an escaped quote without treating the rest of the file as a string', () => {
    const source = [
      `const sql = 'it\\'s fine';`,
      `await pool.query('GRANT USAGE ON ${SCHEMA_KW} public TO probe_role');`,
    ].join('\n');
    expect(findHotCatalogGrants(source).hot).toHaveLength(1);
  });
});

describe('#2474 — the tree the screen actually guards', () => {
  const CONVERTED = [
    'tests/integration/analytics-ingest-rls.test.ts',
    'tests/integration/rls-connection-affinity.test.ts',
    'tests/integration/rls-policy-shape-2438.test.ts',
    'tests/integration/superadmin-panel-sql.test.ts',
  ];

  for (const path of CONVERTED) {
    it(`${path} takes privileges through the helper`, () => {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('ensureRlsProbeRole');
      expect(source).toContain('releaseRlsProbeRole');
      expect(findHotCatalogGrants(source).hot).toHaveLength(0);
      // #2474 criterion 3: the teardown no longer needs a DROP OWNED BY, because
      // the role arrives with no object ACL behind it. Checked against the SQL a
      // suite hands Postgres rather than the file's text — two of these files say
      // "no DROP OWNED BY" in a comment to explain exactly that, and policing
      // prose is the failure mode this screen was rewritten to remove.
      const executed = stringLiterals(source).map((literal) => literal.text);
      expect(executed.some((text) => /DROP\s+OWNED\s+BY/i.test(text))).toBe(false);
    });
  }

  it('is clean — and clean because it was read', () => {
    const { scanned, violations } = scanTree(process.cwd());
    expect(violations).toHaveLength(0);
    expect(scanned).toBeGreaterThan(400);
    expect(existsSync(join(process.cwd(), HELPER_PATH))).toBe(true);
  });

  it('would not be silent if a fifth suite appeared', () => {
    // The non-vacuity half of the test above: the same scanner, over the same
    // helper, names the statement in a file that has not been converted yet.
    expect(findHotCatalogGrants(racingSuite()).hot.length).toBeGreaterThan(0);
    expect(
      [...racingSuite().matchAll(new RegExp(HOT_CATALOG_DDL.source, 'gi'))].length,
    ).toBeGreaterThan(0);
  });
});
