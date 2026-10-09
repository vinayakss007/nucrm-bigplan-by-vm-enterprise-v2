/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2474 — the screen that stops a fifth suite from rejoining the race.
 *
 * `GRANT … ON SCHEMA public` is an UPDATE of the single `pg_namespace` row named
 * `public`. Four suites each issued one in `beforeAll`; vitest runs one worker
 * per file, so all four landed in the same second and `superadmin-panel-sql`
 * died with `XX000 tuple concurrently updated` on a CI run of a PR that never
 * touched it. The repair (role membership instead of object ACLs) is in
 * `tests/helpers/rls-probe-role-2474.ts`; this file proves the guard that keeps
 * the class out, which is acceptance criterion 4 — the part that matters, since
 * the race itself is not deterministic and four racers were winning it for weeks.
 *
 * Proving a screen means proving it *fires*, so the negative-control half plants
 * each statement and expects a finding; the "already fixed" half runs the real
 * tree and expects none.
 *
 * catalog-ddl: allow-file — the fixtures below quote the statements the screen
 * forbids, and a guard that flags the test proving it fires is a guard nobody
 * can run. `this file is exempt by marker, not by accident` is itself asserted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DB_CONNECTED, FILE_HATCH, RULES, scanSource, scanTree, stripComments } from '../../scripts/check-test-catalog-ddl.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');

/** A file that reaches a database — the precondition the screen asks for. */
const PG_IMPORT = "import { Pool } from 'pg';\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\n";

function dbFile(body: string): string {
  return `${PG_IMPORT}\nexport async function setup() {\n${body}\n}\n`;
}

describe('stripComments', () => {
  it('blanks line comments without moving the following line', () => {
    const out = stripComments('// GRANT USAGE ON SCHEMA public TO x\nconst a = 1;');
    expect(out.split('\n')[0]).not.toContain('GRANT');
    expect(out.split('\n')[1]).toBe('const a = 1;');
  });

  it('blanks block comments that span lines', () => {
    const src = '/*\n * GRANT USAGE ON SCHEMA public TO x\n */\nconst a = 1;';
    expect(stripComments(src)).not.toContain('GRANT');
    expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
  });

  it('keeps string contents, so a real statement is still visible', () => {
    expect(stripComments('await pool.query(`GRANT USAGE ON SCHEMA public TO x`);')).toContain('GRANT USAGE ON SCHEMA public TO x');
  });
});

describe('scanSource — the class it must catch', () => {
  it.each([
    ['schema-acl', 'await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);'],
    ['schema-acl', 'await pool.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`).catch(() => {});'],
    ['mass-object-acl', 'await pool.query(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${ROLE}`);'],
    ['object-acl', 'await pool.query(`GRANT SELECT, INSERT ON activities TO ${ROLE}`);'],
    ['object-acl', 'await pool.query(`REVOKE SELECT, INSERT ON activities FROM ${ROLE}`);'],
    ['default-privileges', 'await pool.query(`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO ${ROLE}`);'],
    ['drop-owned', 'await pool.query(`DROP OWNED BY ${ROLE}`);'],
  ])('%s fires on %s', (rule, statement) => {
    const { violations } = scanSource(dbFile(statement));
    expect(violations.map(v => v.rule)).toContain(rule);
  });

  it('names the rule, the line and the statement so the failure is actionable', () => {
    const [first] = scanSource(dbFile('await pool.query(`GRANT USAGE ON SCHEMA public TO x`);')).violations;
    expect(first).toMatchObject({ rule: 'schema-acl', line: 5 });
    expect(first.what).toMatch(/pg_namespace/);
    expect(first.text).toMatch(/GRANT USAGE ON SCHEMA public/);
  });

  it('catches every rule the module declares — no dead rule', () => {
    const probes: Record<string, string> = {
      'schema-acl': 'GRANT USAGE ON SCHEMA public TO x;',
      'mass-object-acl': 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO x;',
      'object-acl': 'GRANT SELECT ON contacts TO x;',
      'default-privileges': 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO x;',
      'drop-owned': 'DROP OWNED BY x;',
    };
    for (const rule of RULES) {
      expect(probes[rule.id], `rule ${rule.id} has no probe here`).toBeTruthy();
      expect(scanSource(dbFile(`await pool.query(${JSON.stringify(probes[rule.id])});`)).violations.map(v => v.rule)).toContain(rule.id);
    }
  });
});

describe('scanSource — what it must NOT catch', () => {
  it('lets the sanctioned membership form through', () => {
    const sanctioned = dbFile(`
      await pool.query(\`CREATE ROLE "\${ROLE}" NOSUPERUSER NOBYPASSRLS INHERIT NOLOGIN\`);
      await pool.query('GRANT pg_read_all_data TO "' + ROLE + '"');
      await pool.query('GRANT pg_write_all_data TO "' + ROLE + '"');
      await pool.query('GRANT "' + ROLE + '" TO CURRENT_USER');
      await pool.query('DROP ROLE IF EXISTS "' + ROLE + '"');
    `);
    expect(scanSource(sanctioned).violations).toEqual([]);
  });

  it('ignores prose: the fix explains the old form by naming it', () => {
    expect(scanSource(dbFile('// `GRANT USAGE ON SCHEMA public` is what stood here\n'))).toMatchObject({
      connected: true,
      violations: [],
    });
  });

  it('honours the documented escape hatch', () => {
    const src = dbFile('await pool.query(`GRANT USAGE ON SCHEMA public TO x`); // catalog-ddl: allow — one schema, one writer');
    expect(scanSource(src).violations).toEqual([]);
  });

  it('skips a file that cannot reach a database, because its SQL is an assertion', () => {
    // The two real cases: both quote the pattern to say something about
    // provisioning or about a teardown that must NOT contain it.
    for (const rel of ['tests/unit/rls-least-privilege-role.test.ts', 'tests/unit/integration-rls-restore-2455.test.ts']) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src).toMatch(/GRANT|REVOKE/);
      expect(scanSource(src)).toMatchObject({
        connected: false,
        violations: [],
      });
    }
  });
});

describe('the screen over the real tree', () => {
  it('is clean — no database-connected test file writes a shared catalog tuple', () => {
    const { findings, files, dbConnectedFiles } = scanTree(join(ROOT, 'tests'));
    expect(files).toBeGreaterThan(400);
    expect(dbConnectedFiles).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });

  it('exempts exactly one file, and it is this one', () => {
    const { exempt } = scanTree(join(ROOT, 'tests'));
    expect(exempt).toEqual([relative(ROOT, import.meta.filename)]);
  });

  it('this file is exempt by the marker, not by being unreadable to the rules', () => {
    // Strip the marker and re-scan the same bytes: the fixtures planted here do
    // fire, which is what makes the exemption narrow instead of a loophole.
    const src = readFileSync(import.meta.filename, 'utf8');
    expect(src).toContain(FILE_HATCH);
    const withoutMarker = src.replace(FILE_HATCH, 'catalog-ddl: used-to-be-exempt');
    const { violations } = scanSource(withoutMarker);
    expect(violations.length).toBeGreaterThan(5);
    expect(new Set(violations.map(v => v.rule))).toEqual(new Set(['schema-acl', 'mass-object-acl', 'object-acl', 'default-privileges', 'drop-owned']));
  });

  it('would have gone red on the four suites this PR changes', () => {
    // The same rule set, run over the statements the PR removed. This is the
    // reproduction #2474 says it does not have: the race is a lottery, the
    // statements are not.
    const removed = [
      'GRANT USAGE ON SCHEMA public TO rls_affinity_test_role',
      'GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}',
      'GRANT USAGE ON SCHEMA public TO ${RLS_TEST_ROLE}',
      'REVOKE USAGE ON SCHEMA public FROM ${RLS_TEST_ROLE}',
      'GRANT SELECT, INSERT ON activities TO ${RLS_TEST_ROLE}',
    ];
    for (const statement of removed) {
      expect(scanSource(dbFile(`await pool.query(\`${statement}\`);`)).violations, statement).toHaveLength(1);
    }
  });

  it('pins the discriminator list, so widening it is a deliberate edit', () => {
    // The screen's whole precision comes from this list. If a marker is dropped,
    // a real suite goes unscanned; if a loose one is added, a unit test quoting
    // provisioning SQL goes red. Either way the change belongs in review.
    expect(DB_CONNECTED.map(re => re.source)).toEqual([
      'from [\'"]pg[\'"]',
      'require\\([\'"]pg[\'"]\\)',
      'from [\'"]postgres[\'"]',
      '\\bnew Pool\\s*\\(',
      '\\bcreatePool\\s*\\(',
      '\\bpool\\.(?:query|connect)\\b',
      '\\bdb\\.execute\\s*\\(',
      '\\bDATABASE_URL\\b',
    ]);
  });

  it('each marker recognises the shape it names', () => {
    const connectedSamples = [
      "import { Pool } from 'pg';",
      "const pg = require('pg');",
      "import postgres from 'postgres';",
      'const pool = new Pool({ connectionString });',
      'const pool = await createPool();',
      'await pool.query(sql);',
      'const c = await pool.connect();',
      'await db.execute(sql`SELECT 1`);',
      'const url = process.env.DATABASE_URL;',
    ];
    for (const sample of connectedSamples) {
      expect(
        DB_CONNECTED.some(re => re.test(sample)),
        sample,
      ).toBe(true);
    }
  });

  it('does not treat a source-reading unit test as database-connected', () => {
    for (const rel of ['tests/unit/rls-least-privilege-role.test.ts', 'tests/unit/integration-rls-restore-2455.test.ts']) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(
        DB_CONNECTED.some(re => re.test(src)),
        rel,
      ).toBe(false);
    }
  });
});
