/**
 * #2455 — the capture/restore path that replaces `superadmin-panel-sql`'s
 * drop-everything-and-retype ritual, tested without a database.
 *
 * WHY THESE ARE THE RIGHT THINGS TO PIN
 * -------------------------------------
 * The defect was not "the test mutated the schema" (an RLS proof has to). It was
 * that the mutation was *unaccounted*: `DROP POLICY` over every row of
 * `pg_policy` on `activities`, then one hand-typed `CREATE POLICY`. So a second
 * policy — the one some future migration adds — would be destroyed on every
 * database the suite touched, and the policy the proof rested on was a copy of a
 * string, which means a migration that REMOVED the `app.is_super_admin` bypass
 * would have been re-added by the very test meant to notice it. #2451 proved the
 * same class on `contacts` and fixed it with catalogue-text capture; this is the
 * `activities` half.
 *
 * Every expression below is `pg_policies.qual` / `.with_check` output captured
 * from a real database (preprod read-only, and the journal-built scratch
 * databases), because the restore's whole claim is "re-issue the text Postgres
 * reported for it" — a paraphrased fixture would test the paraphrase.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildCreatePolicySql,
  planRlsRestore,
  type CapturedPolicy,
  type CapturedRls,
} from '../helpers/rls-policy-restore';
import {
  countBypassArmsInMigrationSql,
  expressionCarriesSuperAdminBypass,
  policyCarriesSuperAdminBypass,
  SUPER_ADMIN_BYPASS_PARAM,
} from '../../scripts/rls-policy-shape.mjs';

const TENANT_ARM =
  `(tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid)`;
const BYPASS_ARM =
  `((NULLIF(current_setting('app.is_super_admin'::text, true), ''::text))::boolean = true)`;
/** What 0092 leaves on `activities` in every database this repo builds. */
const SHIPPED_QUAL = `${TENANT_ARM} OR ${BYPASS_ARM}`;
/** The pre-0039/0092 shape: one argument, so a missing GUC aborts the statement. */
const STRICT_QUAL = `(tenant_id = current_setting('app.current_tenant'))`;

const policy = (over: Partial<CapturedPolicy> = {}): CapturedPolicy => ({
  name: 'tenant_isolation',
  cmd: 'ALL',
  permissive: 'PERMISSIVE',
  roles: ['public'],
  qual: SHIPPED_QUAL,
  withCheck: SHIPPED_QUAL,
  ...over,
});

const snapshot = (over: Partial<CapturedRls> = {}): CapturedRls => ({
  table: 'activities',
  enabled: true,
  forced: false,
  policies: [policy()],
  ...over,
});

describe('buildCreatePolicySql (#2455 restore text comes from the catalogue)', () => {
  it('re-issues name, strictness, command, roles and both expressions', () => {
    const sql = buildCreatePolicySql('activities', policy());
    expect(sql).toContain('CREATE POLICY "tenant_isolation" ON "activities"');
    expect(sql).toContain('AS PERMISSIVE');
    expect(sql).toContain('FOR ALL');
    expect(sql).toContain('TO "public"');
    expect(sql).toContain(`USING (${SHIPPED_QUAL})`);
    expect(sql).toContain(`WITH CHECK (${SHIPPED_QUAL})`);
  });

  it('keeps a policy that is not FOR ALL — restoring it as FOR ALL would widen it', () => {
    const sql = buildCreatePolicySql(
      'activities',
      policy({ name: 'member_read', cmd: 'SELECT', withCheck: null }),
    );
    expect(sql).toContain('FOR SELECT');
    // A SELECT policy has no WITH CHECK; emitting `WITH CHECK (…)` on one is a
    // syntax error, so the clause is simply absent.
    expect(sql).not.toContain('WITH CHECK');
  });

  it('preserves restrictive strictness and named roles', () => {
    const sql = buildCreatePolicySql(
      'activities',
      policy({ permissive: 'RESTRICTIVE', roles: ['app_user', 'report_reader'] }),
    );
    expect(sql).toContain('AS RESTRICTIVE');
    expect(sql).toContain('TO "app_user", "report_reader"');
  });

  it('quotes a nasty policy name instead of trusting it', () => {
    const sql = buildCreatePolicySql('activities', policy({ name: 'we"ird' }));
    expect(sql).toContain('CREATE POLICY "we""ird"');
  });

  it('refuses a cmd or strictness Postgres would never have reported', () => {
    expect(() => buildCreatePolicySql('activities', policy({ cmd: 'TRUNCATE' }))).toThrow(/command/);
    expect(() => buildCreatePolicySql('activities', policy({ permissive: 'LOOSE' }))).toThrow(/strictness/);
  });
});

describe('planRlsRestore (#2455: extras dropped, every captured policy re-issued)', () => {
  it('drops the fixture, then re-issues the captured policy from its own text', () => {
    const statements = planRlsRestore(snapshot(), [
      'tenant_isolation',
      'superadmin_panel_sql_fixture_isolation',
    ]);
    expect(statements[0]).toBe(
      'DROP POLICY IF EXISTS "superadmin_panel_sql_fixture_isolation" ON "activities"',
    );
    const createIndex = statements.findIndex((s) => s.startsWith('CREATE POLICY "tenant_isolation"'));
    expect(createIndex).toBeGreaterThan(0);
    // The shipped policy was never dropped by the suite, so it is still live —
    // `already exists` is what a bare CREATE would hit. Dropping the name inside
    // the same transaction, immediately before re-creating the captured text, is
    // what makes the restore idempotent AND exact: an in-place alteration cannot
    // survive it either.
    expect(statements[createIndex - 1]).toBe(
      'DROP POLICY IF EXISTS "tenant_isolation" ON "activities"',
    );
    expect(statements[createIndex]).toContain(`USING (${SHIPPED_QUAL})`);
  });

  it('re-creates a SECOND policy the suite never touched — the destroyed-by-default case', () => {
    const before = snapshot({
      policies: [policy(), policy({ name: 'tenant_member_read', cmd: 'SELECT' })],
    });
    // The old suite dropped both and created one; this is the assertion that a
    // migration-added policy comes back.
    const statements = planRlsRestore(before, ['tenant_isolation']);
    expect(statements.filter((s) => s.startsWith('CREATE POLICY'))).toHaveLength(2);
    expect(statements.join('\n')).toContain('CREATE POLICY "tenant_member_read"');
    expect(statements.join('\n')).toContain('FOR SELECT');
  });

  it('re-creates a captured policy that is missing now (a previous partial run)', () => {
    const statements = planRlsRestore(snapshot(), []);
    expect(statements.some((s) => s.startsWith('CREATE POLICY "tenant_isolation"'))).toBe(true);
    // The pairing DROP cannot assume the policy is there — this is exactly the
    // case where it is not — so it has to be `IF EXISTS` or the restore aborts on
    // the very table it is trying to repair.
    expect(statements).toContain('DROP POLICY IF EXISTS "tenant_isolation" ON "activities"');
  });

  it('never leaves a captured policy dropped without putting it back', () => {
    const before = snapshot();
    const statements = planRlsRestore(before, ['tenant_isolation', 'other']);
    const droppedNames = statements
      .filter((s) => s.startsWith('DROP POLICY'))
      .map((s) => /DROP POLICY(?: IF EXISTS)? "([^"]+)"/.exec(s)?.[1]);
    expect(droppedNames).toEqual(['other', 'tenant_isolation']);
    for (const policy of before.policies) {
      const dropIndex = statements.findIndex((s) => s.includes(`"${policy.name}"`) && s.startsWith('DROP'));
      const createIndex = statements.findIndex((s) => s.startsWith(`CREATE POLICY "${policy.name}"`));
      expect(createIndex, `${policy.name} was dropped; nothing re-created it`).toBe(dropIndex + 1);
    }
    // A name that was never captured stays gone — it is what this suite added.
    expect(statements.some((s) => s.includes('CREATE POLICY "other"'))).toBe(false);
  });

  it('restores the RLS flags, including the case where the suite enabled them', () => {
    const statements = planRlsRestore(snapshot({ enabled: false }), []);
    expect(statements).toContain('ALTER TABLE "activities" DISABLE ROW LEVEL SECURITY');

    const forced = planRlsRestore(snapshot({ forced: true }), []);
    expect(forced).toContain('ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY');
    expect(forced).toContain('ALTER TABLE "activities" FORCE ROW LEVEL SECURITY');
    expect(statements).toContain('ALTER TABLE "activities" NO FORCE ROW LEVEL SECURITY');
  });
});

describe('the shipped bypass is asserted from 0092, not retyped (#2455)', () => {
  const dir = path.resolve('drizzle/migrations');
  const file = fs.readdirSync(dir).find((f) => f.startsWith('0092_') && f.endsWith('.sql') && !f.endsWith('.down.sql'));

  it('0092 exists and writes the fail-closed bypass into both arms', () => {
    expect(file, `no 0092_* migration in ${dir}`).toBeTruthy();
    const arms = countBypassArmsInMigrationSql(fs.readFileSync(path.join(dir, file!), 'utf-8'));
    // USING + WITH CHECK, in the two-argument form. A count of 1 would mean one
    // half silently lost the bypass — the write-path abort #2438 was filed for.
    expect(arms).toBe(2);
  });

  it('recognises the deparse a live database reports', () => {
    expect(expressionCarriesSuperAdminBypass(SHIPPED_QUAL)).toBe(true);
    expect(expressionCarriesSuperAdminBypass(STRICT_QUAL)).toBe(false);
    // The one-argument bypass call aborts instead of denying, so it is not a
    // bypass this proof may rely on.
    expect(
      expressionCarriesSuperAdminBypass(`((NULLIF(current_setting('${SUPER_ADMIN_BYPASS_PARAM}'::text), ''::text))::boolean = true)`),
    ).toBe(false);
  });

  it('checks both halves, and only requires WITH CHECK when Postgres reports one', () => {
    expect(policyCarriesSuperAdminBypass(policy())).toEqual({ ok: true, missing: [] });
    expect(policyCarriesSuperAdminBypass(policy({ withCheck: STRICT_QUAL }))).toEqual({
      ok: false,
      missing: ['WITH CHECK'],
    });
    expect(policyCarriesSuperAdminBypass(policy({ qual: STRICT_QUAL }))).toEqual({
      ok: false,
      missing: ['USING'],
    });
    expect(policyCarriesSuperAdminBypass(policy({ withCheck: null }))).toEqual({ ok: true, missing: [] });
  });
});
