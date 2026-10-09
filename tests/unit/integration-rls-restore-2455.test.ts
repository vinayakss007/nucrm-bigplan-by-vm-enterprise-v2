/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2455 — the super-admin RLS proofs must stop re-writing the database.
 *
 * `tests/integration/superadmin-panel-sql.test.ts` used to ENABLE RLS, DROP every
 * policy on `activities`, and re-CREATE a hand-typed copy under the shipped name
 * `tenant_isolation`. Three failures, none of them visible in CI:
 *
 *   1. A policy a FUTURE migration adds to `activities` is deleted by this suite
 *      on every database it touches, while the proof still passes on its own copy.
 *   2. The hand-typed arms are a second copy of a rule that lives in
 *      `0092_metrics_tables_superadmin_bypass.sql`. Nothing ties them together, so
 *      the day the migration changes the arm the test keeps proving the OLD rule —
 *      and worse, its restore then INSTALLS that stale rule over the live one.
 *      #2438 was filed for precisely the single-argument `current_setting()` that
 *      the old copy carried.
 *   3. The test role and its `GRANT`s were left behind in the database.
 *
 * The fix is `tests/helpers/shipped-rls-policy.ts` (read the shipped object out of
 * the migration instead of typing it) plus capture-before-mutate, a fixture under
 * its own name, and a teardown that removes exactly what was added.
 *
 * WHY A UNIT TEST FOR AN INTEGRATION FIX: the CI database is provisioned by
 * `db:sync`, so `admitsSuperAdmin` is what decides whether a fixture gets
 * installed there, and `readShippedPolicy` is what runs on every integration run —
 * both are pure logic over a file and a query result. This suite pins them without
 * a connection, plants the migrations that must throw, and then reads the
 * integration file itself as text to prove the destructive statements are gone.
 * The `describe` block that needs a live database self-skips when none is
 * reachable, so without these assertions CI could merge a regression here while
 * printing a green row.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIGRATION_0092,
  SHIPPED_POLICY_NAME,
  readShippedPolicy,
  admitsSuperAdmin,
  type CapturedPolicy,
} from '../helpers/shipped-rls-policy';
import { stripComments } from '../../scripts/check-public-row-projection.mts';

const INTEGRATION_FILE = join('tests', 'integration', 'superadmin-panel-sql.test.ts');

/**
 * Comments carry the prose that quotes the very statements under audit ("the file
 * used to DROP POLICY …"), so a scan that reads them would pass on documentation
 * alone. Same blanking rule the projection guard applies to handler bodies.
 */
function codeOf(relPath: string): string {
  return stripComments(readFileSync(relPath, 'utf8'));
}

const code = codeOf(INTEGRATION_FILE);

/** A `pg_policies` row with the shipped shape — a full bypass, usable by anyone. */
function shippedLike(over: Partial<CapturedPolicy> = {}): CapturedPolicy {
  return {
    name: SHIPPED_POLICY_NAME,
    cmd: 'ALL',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qual:
      "((tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) "
      + "OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true))",
    withCheck:
      "((tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) "
      + "OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true))",
    ...over,
  };
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'rls-policy-2455-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

/**
 * A migration file holding the given `format(…)` body, so a near-miss can be
 * planted without editing the real 0092.
 */
function writeMigration(body: string): { path: string; root: string } {
  const name = `fixture_${Math.random().toString(36).slice(2, 10)}.sql`;
  const root = join(tmpRoot, name.replace(/\.sql$/, ''));
  const dir = join(root, 'drizzle', 'migrations');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `DO $$\nBEGIN\n${body}\nEND $$;\n`, 'utf8');
  // The helper resolves `join(root, migrationPath)`, mirroring how it reads the
  // real file out of the project root, so the returned path is the relative one.
  return { path: join('drizzle', 'migrations', name), root };
}

/** The statement as 0092 writes it, minus the super-admin arm. */
const MIGRATION_WITHOUT_BYPASS = String.raw`
      'CREATE POLICY "tenant_isolation" ON %I FOR ALL USING ('
      '(tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      ') WITH CHECK ('
      '(tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      ');', t);
`;

/** The same, with one call collapsed to the raising single-argument form (#2438). */
const MIGRATION_RAISING = String.raw`
      'CREATE POLICY "tenant_isolation" ON %I FOR ALL USING ('
      '(tenant_id = NULLIF(current_setting(''app.current_tenant''), '''')::uuid) '
      'OR ((NULLIF(current_setting(''app.is_super_admin'', true), ''''))::boolean = true)'
      ') WITH CHECK ('
      '(tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      ');', t);
`;

/** Truncated mid-statement: the last literal never closes the `);`. */
const MIGRATION_INCOMPLETE = String.raw`
      'CREATE POLICY "tenant_isolation" ON %I FOR ALL USING ('
      '(NULLIF(current_setting(''app.is_super_admin'', true), ''''))::boolean = true) ', t);
`;

describe('readShippedPolicy — the fixture is the shipped object (#2455)', () => {
  const policy = readShippedPolicy(MIGRATION_0092, '.');

  it('reassembles 0092\'s concatenated literals into one complete statement', () => {
    expect(policy.template.startsWith(`CREATE POLICY "${SHIPPED_POLICY_NAME}" ON %I FOR ALL`)).toBe(true);
    expect(policy.template).toContain('WITH CHECK');
    // The run of adjacent literals is stitched with no stray quote noise: `''`
    // must have been un-doubled, and nothing from the surrounding `format(…)` may
    // have leaked into the statement.
    expect(policy.template).toContain("current_setting('app.current_tenant', true)");
    expect(policy.template).not.toContain("''''");
    expect(policy.template).not.toContain('format(');
    expect(policy.template).not.toContain('FOREACH');
  });

  it('consults the tenant GUC and the platform GUC, in that order', () => {
    expect(policy.settings).toEqual(['app.current_tenant', 'app.is_super_admin']);
  });

  it('builds DDL for the shipped name when the caller does not name one', () => {
    const stmt = policy.statementFor('activities');
    expect(stmt.startsWith(`CREATE POLICY "${SHIPPED_POLICY_NAME}" ON "activities" FOR ALL`)).toBe(true);
    expect(stmt).not.toContain('%I');
    expect(stmt.match(/app\.is_super_admin/g)).toHaveLength(2);
  });

  it('swaps the name without touching the arms, so a fixture can never overwrite the shipped object', () => {
    const stmt = policy.statementFor('activities', 'my_fixture_isolation');
    expect(stmt).toContain(`CREATE POLICY "my_fixture_isolation" ON "activities"`);
    expect(stmt).not.toContain(`"${SHIPPED_POLICY_NAME}"`);
    // Same arms under a different label — that is the whole point of reading the
    // migration instead of writing a second copy.
    expect(stmt.replace('"my_fixture_isolation"', `"${SHIPPED_POLICY_NAME}"`)).toBe(policy.statementFor('activities'));
  });

  it('refuses to build DDL for anything that is not a plain lowercase identifier', () => {
    // Both arguments land inside quotes in a CREATE POLICY statement, so a value
    // carrying a quote or a semicolon would be an injection into the suite\'s own
    // teardown DDL.
    for (const bad of ['activities; DROP TABLE users', 'Activities', 'a"b', 'x-y', '']) {
      expect(() => policy.statementFor(bad)).toThrow(/non-conforming identifier/);
      expect(() => policy.statementFor('activities', bad)).toThrow(/non-conforming identifier/);
    }
  });

  it('throws when the migration stops building a policy at all', () => {
    const { path, root } = writeMigration(`      'ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);`);
    expect(() => readShippedPolicy(path, root)).toThrow(/no longer builds a CREATE POLICY/);
  });

  it('throws when the shipped arms lose the super-admin bypass', () => {
    // This is assertion 2 above: the migration is allowed to change, but not to
    // change silently out from under a suite that documents the bypass as fact.
    const { path, root } = writeMigration(MIGRATION_WITHOUT_BYPASS);
    expect(() => readShippedPolicy(path, root)).toThrow(/app\.is_super_admin/);
  });

  it('throws when the shipped arms regress to the raising current_setting() (#2438)', () => {
    const { path, root } = writeMigration(MIGRATION_RAISING);
    expect(() => readShippedPolicy(path, root)).toThrow(/raises instead of denying/);
  });

  it('throws on a template that is not a complete statement', () => {
    const { path, root } = writeMigration(MIGRATION_INCOMPLETE);
    expect(() => readShippedPolicy(path, root)).toThrow(/not a complete CREATE POLICY/);
  });

  it('reads the real migration as the union of those three failure modes being absent', () => {
    // The three planted fixtures above each throw for a different reason; the
    // shipped file has to pass all of them, or one throw masks another.
    expect(() => readShippedPolicy(MIGRATION_0092, '.')).not.toThrow();
  });
});

describe('admitsSuperAdmin — reading the LIVE policy, not the fixture', () => {
  it('accepts a full bypass on both sides', () => {
    expect(admitsSuperAdmin([shippedLike()])).toEqual({ reads: true, writes: true });
  });

  it('rejects an empty policy list — nothing is installed yet', () => {
    expect(admitsSuperAdmin([])).toEqual({ reads: false, writes: false });
  });

  it('rejects a bypass that is only half a bypass', () => {
    // The #2455 failure mode in miniature: the platform context can read the
    // marker row but cannot write it, so dedup re-mails every tenant while a test
    // that only asked about reads still passes.
    expect(admitsSuperAdmin([shippedLike({ cmd: 'SELECT', withCheck: null })])).toEqual({ reads: true, writes: false });
    expect(admitsSuperAdmin([shippedLike({ cmd: 'INSERT', qual: null })])).toEqual({ reads: false, writes: true });
  });

  it('looks in USING for reads and WITH CHECK for writes, not in either arm for both', () => {
    const onlyInCheck = shippedLike({ qual: "(tenant_id = 'x'::uuid)", withCheck: shippedLike().withCheck });
    expect(admitsSuperAdmin([onlyInCheck])).toEqual({ reads: false, writes: true });
    const onlyInUsing = shippedLike({ qual: shippedLike().qual, withCheck: "(tenant_id = 'x'::uuid)" });
    expect(admitsSuperAdmin([onlyInUsing])).toEqual({ reads: true, writes: false });
  });

  it('rejects a policy with no bypass at all', () => {
    expect(
      admitsSuperAdmin([
        shippedLike({
          qual: "(tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)",
          withCheck: "(tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)",
        }),
      ]),
    ).toEqual({ reads: false, writes: false });
  });

  it('ignores a bypass written for someone else\'s role', () => {
    // Guessing wrong in this direction costs a second fixture that teardown drops;
    // the other direction would leave the suite\'s own INSERT denied.
    expect(admitsSuperAdmin([shippedLike({ roles: ['some_app_role'] })])).toEqual({ reads: false, writes: false });
    expect(admitsSuperAdmin([shippedLike({ roles: [] })])).toEqual({ reads: true, writes: true });
    expect(admitsSuperAdmin([shippedLike({ roles: ['=public'] })])).toEqual({ reads: true, writes: true });
  });

  it('finds a bypass in any policy of the set, including SELECT + INSERT pairs', () => {
    expect(
      admitsSuperAdmin([
        shippedLike({ name: 'read_bypass', cmd: 'SELECT', withCheck: null }),
        shippedLike({ name: 'write_bypass', cmd: 'INSERT', qual: null }),
      ]),
    ).toEqual({ reads: true, writes: true });
  });
});

describe('the migration is the source of truth for the integration suite', () => {
  it('imports the helper instead of keeping its own copy of the arms', () => {
    expect(code).toContain("from '../helpers/shipped-rls-policy'");
    expect(code).not.toMatch(/CREATE POLICY/);
    // A re-inlined classifier is how the copy and the shipped object drift apart
    // again (#2455 is about there being exactly one of each).
    expect(code).not.toMatch(/function admitsSuperAdmin/);
  });

  it('installs its fixture under a name that is not the shipped one', () => {
    const m = /const FIXTURE_POLICY_NAME = '([a-z0-9_]+)'/.exec(readFileSync(INTEGRATION_FILE, 'utf8'));
    expect(m).not.toBeNull();
    expect(m?.[1]).not.toBe(SHIPPED_POLICY_NAME);
    expect(m?.[1]).toMatch(/^[a-z_][a-z0-9_]*$/);
    // Proves the fixture name actually survives the helper\'s identifier guard —
    // a name it rejects would throw inside beforeAll instead.
    expect(() => readShippedPolicy().statementFor('activities', m?.[1] ?? '')).not.toThrow();
  });

  it('captures the state before it changes anything', () => {
    const capture = code.indexOf('activitiesBefore = await captureActivitiesRls()');
    expect(capture).toBeGreaterThan(-1);
    for (const mutation of ['ENABLE ROW LEVEL SECURITY', 'readShippedPolicy()', 'INSERT INTO tenants']) {
      expect(code.indexOf(mutation)).toBeGreaterThan(capture);
    }
    // And the post-teardown re-read is only used for the audit, never as the
    // restore source.
    expect(code).toContain('const after = await captureActivitiesRls()');
  });

  it('drops only what it added, inside one transaction', () => {
    const drops = [...code.matchAll(/DROP POLICY[^;]*/g)].map((m) => m[0]);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain('FIXTURE_POLICY_NAME');
    expect(drops[0]).not.toContain(SHIPPED_POLICY_NAME);
    expect(code.indexOf("'BEGIN'")).toBeLessThan(code.indexOf('DROP POLICY'));
    expect(code.indexOf("'COMMIT'")).toBeGreaterThan(code.indexOf('DROP POLICY'));
    expect(code).toContain("'ROLLBACK'");
    // RLS is only disabled when this file enabled it — a schema that shipped with
    // RLS on must not be turned off by a test.
    expect(code).toMatch(/if \(enabledRlsHere\)[\s\S]{0,120}DISABLE ROW LEVEL SECURITY/);
  });

  it('removes the role it created, and nothing that was already there', () => {
    // #2474 moved the role's privileges from object ACLs (`GRANT USAGE ON SCHEMA
    // public`, `GRANT SELECT, INSERT ON activities`) to membership in the
    // predefined read/write roles, because an ACL grant on `public` is an UPDATE
    // of one hot catalogue tuple that every suite's setup races for. So there is
    // no schema ACL left to revoke — and asserting one here would demand the very
    // statement that made this file's setup a hazard to its neighbours.
    expect(code).toContain('ensureRlsProbeRole');
    expect(code).toContain('releaseRlsProbeRole');
    expect(code).not.toMatch(/GRANT (USAGE ON SCHEMA public|SELECT, INSERT ON activities)/);
    // The release is what owes the unwind; the #2466 rule is that it only touches
    // a role this run created, and says so when it found one already in the cluster.
    expect(code).toMatch(/probe\.createdHere/);
    expect(code).toContain('already existed before this run');
    // And the helper is the one place that knows how the role comes apart.
    const helper = readFileSync('tests/helpers/rls-probe-role.ts', 'utf8');
    for (const stmt of ['REVOKE "${handle.role}" FROM CURRENT_USER', 'DROP ROLE IF EXISTS']) {
      expect(helper).toContain(stmt);
    }
  });

  it('reports a failed restore instead of swallowing it', () => {
    // `.catch(() => {})` over teardown DDL is exactly why the destructive version
    // survived every CI run.
    expect(code).toMatch(/failures\.push\(/);
    expect(code).toMatch(/throw new Error\(\s*`superadmin-panel-sql could not leave the database as it found it/);
    expect(code).toMatch(/policies destroyed by this suite/);
  });

  it('still proves the same behaviour the old file proved', () => {
    // Guarding against a "fix" that keeps the teardown tidy and drops the point.
    expect(code).toContain('set_config(\'app.is_super_admin\'');
    expect(code).toContain('42501');
    expect(code).toContain('42883');
    expect(code).toContain('42703');
  });
});
