/**
 * Super-admin panel SQL regression test.
 *
 * WHAT THIS PROVES
 * ----------------
 * Three routes rendered permanently-wrong data because their SQL disagreed
 * with the physical schema, and each swallowed the failure so the panel never
 * surfaced it:
 *
 *   1. app/api/superadmin/usage — the "growth" series compared
 *      usage_snapshots.snapshot_date (a TEXT column, written as
 *      CURRENT_DATE::text) against `CURRENT_DATE - 30` (a DATE). Postgres
 *      raised 42883 operator-does-not-exist and the query's
 *      `.catch(() => [])` turned it into an empty chart (52 hits in
 *      error_logs over 4 days). The fix bounds the comparison in text
 *      (`>= to_char(CURRENT_DATE - 30, 'YYYY-MM-DD')`); ISO dates sort
 *      lexicographically so the text bound is still correct.
 *
 *   2. app/api/superadmin/monitoring — the 24h "active tenants" metric asked
 *      sessions for `tenant_id`, which sessions does not have (a user can
 *      belong to many workspaces; membership lives in tenant_members). That
 *      raised 42703, safeQuery returned its `[{ count: 0 }]` fallback, and the
 *      panel showed zero active tenants forever (14 hits). The fix resolves the
 *      workspace from `users.last_tenant_id` rather than tenant_members: that
 *      table has no policy a platform connection can satisfy, so a membership
 *      join parses but reads 0 rows (~190 exist) and would restore the same
 *      permanent zero by a different route. See issue #7 for the escape.
 *
 *   3. app/api/cron/trial-check — the nightly trial-expiry warning ran on the
 *      bare pool with no tenant GUC. activities is tenant-scoped by RLS, so
 *      the dedup `notExists` marker read could never see a prior warning AND
 *      the marker INSERT was refused with 42501 (swallowed by `.catch`). Every
 *      run therefore re-mailed every trialing tenant. The fix runs both halves
 *      inside withSecurityContext(), which sets app.is_super_admin for the
 *      transaction.
 *
 * Bugs 1 and 2 are pure SQL-vs-schema correctness, so their statements run on
 * the ordinary (super-user) connection — a type/column mismatch fails at the
 * analyzer regardless of who asks. Bug 3 is an RLS behaviour proof, so it runs
 * on a dedicated NOSUPERUSER/NOBYPASSRLS/NOINHERIT role with EMPTY GUCs. That
 * role needs a `tenant_isolation` policy on `activities` which admits either a
 * tenant-GUC match or the `app.is_super_admin` boolean, and #2455 is about how it
 * gets one: the policy the schema already has is used as-is, a fixture is
 * installed only on a schema that has none (a `db:sync`-provisioned one), and
 * whatever was there before is put back by text captured from the catalogue — so
 * a second policy on `activities` survives this file, and the shipped object is
 * asserted from `0092`'s own text instead of being retyped here. Like
 * tests/integration/analytics-ingest-rls.test.ts it self-skips when no database
 * is reachable and cleans up every row, grant and policy it touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { captureTableRls, restoreTableRls, type CapturedRls } from '../helpers/rls-policy-restore';
import {
  countBypassArmsInMigrationSql,
  policyCarriesSuperAdminBypass,
  SUPER_ADMIN_BYPASS_PARAM,
} from '../../scripts/rls-policy-shape.mjs';

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    client.release();
    await pool.end();
    return true;
  } catch {
    await pool.end().catch(() => {});
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable();
const d = dbAvailable ? describe : describe.skip;

const RLS_TEST_ROLE = 'superadmin_panel_sql_rls_test_role';
// Synthetic so no real workspace is touched; the activities.tenant_id FK still
// requires a parent tenants row, created below and deleted in afterAll.
const TEST_TENANT_ID = randomUUID();
const PROBE_MARKER = `__superadmin_panel_sql_probe_${TEST_TENANT_ID.slice(0, 8)}__`;

// Exactly the marker cron/trial-check writes to suppress repeat warnings.
const TRIAL_WARNING_INSERT = `
  INSERT INTO activities (tenant_id, user_id, event_type, description, entity_type, entity_id, action)
  VALUES ($1, NULL, 'trial_warning', 'Trial warning sent - 2 days left', 'tenant', $1, 'trial_warning')
`;

/**
 * Only used on a schema that has NO policy at all (a `db:sync`/push-provisioned
 * one), and always dropped again. Named as a fixture on purpose: it is not the
 * shipped object, and the assertion below is what keeps this file honest about
 * that — the proof reads the bypass from `0092`'s text, never from this string.
 */
const FIXTURE_POLICY_NAME = 'superadmin_panel_sql_fixture_isolation';

/** Journal entry that puts `app.is_super_admin` into `tenant_isolation`. */
function readSuperAdminBypassMigration(): { file: string; arms: number } {
  const dir = path.resolve('drizzle/migrations');
  const file = fs.readdirSync(dir).find((f) => f.startsWith('0092_') && f.endsWith('.sql') && !f.endsWith('.down.sql'));
  if (!file) throw new Error(`no 0092_* migration found in ${dir} — the bypass assertion has no shipped object to read`);
  return { file, arms: countBypassArmsInMigrationSql(fs.readFileSync(path.join(dir, file), 'utf-8')) };
}

d('superadmin panel SQL regressions (usage / monitoring / trial-check)', () => {
  let pool: Pool;
  /** `activities`' RLS state as this run found it, restored in afterAll (#2455). */
  let activitiesBefore: CapturedRls;
  /**
   * Whether the role was already in the cluster when this run started. Postgres
   * refuses `DROP ROLE` while *another database* still holds grants for it, so a
   * role this file did not create is not this file's to remove — and failing on
   * it would make the suite depend on the history of whoever's cluster it ran in.
   */
  let rolePreexisted = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Capture before anything is touched, so "restore" means putting back what
    // was here — not what this file believes the schema should look like.
    activitiesBefore = await captureTableRls(pool, 'activities');
    const { rows: existingRole } = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [
      RLS_TEST_ROLE,
    ]);
    rolePreexisted = existingRole.length > 0;

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_TEST_ROLE}') THEN
          CREATE ROLE ${RLS_TEST_ROLE} NOSUPERUSER NOBYPASSRLS NOINHERIT;
        ELSE
          ALTER ROLE ${RLS_TEST_ROLE} NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await pool.query(`GRANT ${RLS_TEST_ROLE} TO CURRENT_USER`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${RLS_TEST_ROLE}`);
    await pool.query(`GRANT SELECT, INSERT ON activities TO ${RLS_TEST_ROLE}`);

    // The proof runs as a role with EMPTY GUCs, so it needs a policy that admits
    // either the tenant match or the super-admin boolean. #2455: use the policy
    // the schema already has, and treat the catalogue as read-only unless there
    // is nothing to use. The reference is `0092`'s own text, so a migration that
    // dropped the bypass fails here rather than being quietly re-created by the
    // suite that was supposed to notice.
    const shipped = readSuperAdminBypassMigration();
    expect(
      shipped.arms,
      `${shipped.file} no longer writes the fail-closed ${SUPER_ADMIN_BYPASS_PARAM} call twice ` +
        `(USING + WITH CHECK) — found ${shipped.arms}. The bypass is what lets a platform ` +
        `connection see activities at all, so either it moved to another entry or it is gone.`,
    ).toBeGreaterThanOrEqual(2);

    const bypassed = activitiesBefore.policies.filter((p) => policyCarriesSuperAdminBypass(p).ok);
    if (activitiesBefore.policies.length > 1) {
      // Permissive policies OR, restrictive ones AND, so a second policy changes
      // what these proofs may expect. Measured today the count is exactly 1
      // (journal build, CI fixture and preprod all agree). If it ever stops
      // being 1, the assertions below need re-deriving — which is the outcome
      // #2455 wants: notice, instead of dropping the stranger and passing anyway.
      throw new Error(
        `activities carries ${activitiesBefore.policies.length} RLS policies ` +
          `(${bypassed.length} with the super-admin bypass). This suite's expectations were derived from a ` +
          `single tenant_isolation policy; re-derive them against the policy set before removing this guard.`,
      );
    }
    if (activitiesBefore.policies.length > 0 && bypassed.length === 0) {
      const verdicts = activitiesBefore.policies.map((p) => {
        const { missing } = policyCarriesSuperAdminBypass(p);
        return `${p.name} (missing in ${missing.join(' + ')})`;
      });
      throw new Error(
        `activities carries ${activitiesBefore.policies.length} RLS policy/policies and none admits a ` +
          `platform connection: ${verdicts.join(', ')}. ${shipped.file} is what ORs ` +
          `${SUPER_ADMIN_BYPASS_PARAM} into tenant_isolation — this suite will not paper over its ` +
          `absence by installing its own copy (#2455).`,
      );
    }

    // Policies are inert while RLS is off, so the flag is set only when the
    // schema needs it, and planRlsRestore() puts it back either way.
    if (!activitiesBefore.enabled) {
      await pool.query(`ALTER TABLE activities ENABLE ROW LEVEL SECURITY`);
    }
    if (activitiesBefore.policies.length === 0) {
      // A push-provisioned schema (`drizzle-kit push`) has no policies at all —
      // the one case where there is no shipped object to test against. The
      // fixture is named as such and afterAll drops it.
      await pool.query(`
        CREATE POLICY "${FIXTURE_POLICY_NAME}" ON "activities" AS PERMISSIVE FOR ALL TO public USING (
          (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
          OR ((NULLIF(current_setting('${SUPER_ADMIN_BYPASS_PARAM}', true), ''))::boolean = true)
        ) WITH CHECK (
          (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
          OR ((NULLIF(current_setting('${SUPER_ADMIN_BYPASS_PARAM}', true), ''))::boolean = true)
        );
      `);
    }

    // Parent row the activities FK demands; only name/slug are required (status
    // and plan_id default), and there is no plan FK or insert trigger on tenants.
    await pool.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT (id) DO NOTHING`,
      [TEST_TENANT_ID, PROBE_MARKER],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    // FK order: activities are cascaded by the tenant delete, but remove them
    // explicitly so a partial run cannot strand a marker row.
    await pool.query(`DELETE FROM activities WHERE tenant_id = $1`, [TEST_TENANT_ID]).catch(() => {});
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TEST_TENANT_ID]).catch(() => {});

    // #2455 — the catalogue is put back before the role is taken away, and a
    // restore that cannot complete is thrown rather than `.catch(() => {})`d: a
    // shared database quietly missing a production policy is the damage this
    // issue was filed about.
    const cleanupFailures = activitiesBefore
      ? (await restoreTableRls(pool, activitiesBefore)).failures
      : [];

    await pool.query(`REVOKE SELECT, INSERT ON activities FROM ${RLS_TEST_ROLE}`).catch(() => {});
    await pool.query(`REVOKE USAGE ON SCHEMA public FROM ${RLS_TEST_ROLE}`).catch(() => {});
    await pool.query(`REVOKE ${RLS_TEST_ROLE} FROM CURRENT_USER`).catch(() => {});
    try {
      await pool.query(`DROP ROLE IF EXISTS ${RLS_TEST_ROLE}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (rolePreexisted) {
        // Not this run's object, and a failure here means some other database in
        // the cluster still holds grants for the name.
        console.warn(`[superadmin-panel-sql] left the pre-existing role in place: ${reason}`);
      } else {
        cleanupFailures.push(`DROP ROLE ${RLS_TEST_ROLE}: ${reason}`);
      }
    }
    await pool.end().catch(() => {});

    if (cleanupFailures.length > 0) {
      throw new Error(`activities cleanup did not complete (#2455):\n  ${cleanupFailures.join('\n  ')}`);
    }
  });

  // A pool connection may be returned still wearing the test role, so every RLS
  // checkout clears session state first and every release re-normalises it.
  async function borrowRlsClient() {
    const client = await pool.connect();
    await client.query('RESET ALL');
    await client.query(`SET ROLE ${RLS_TEST_ROLE}`);
    return client;
  }

  // ── Bug 1: usage_snapshots.snapshot_date is TEXT ──────────────────────────
  it('locks snapshot_date as the text column the growth bound depends on', async () => {
    const { rows } = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'usage_snapshots' AND column_name = 'snapshot_date'`,
    );
    // If a future migration changes this to date, the fixed text comparison
    // becomes suspect and this test is the tripwire.
    expect(rows[0]?.data_type).toBe('text');
  });

  it('runs the fixed growth window without raising 42883', async () => {
    const res = await pool.query(`
      SELECT snapshot_date,
             sum(contacts_count)::int AS contacts,
             sum(deals_count)::int AS deals,
             sum(users_count)::int AS users
      FROM usage_snapshots
      WHERE snapshot_date >= to_char(CURRENT_DATE - 30, 'YYYY-MM-DD')
      GROUP BY snapshot_date
      ORDER BY snapshot_date
    `);
    expect(Array.isArray(res.rows)).toBe(true);
  });

  it('proves the pre-fix text > date growth window rejects with 42883', async () => {
    let code: string | undefined;
    try {
      await pool.query(`
        SELECT snapshot_date, sum(contacts_count)::int
        FROM usage_snapshots
        WHERE snapshot_date > CURRENT_DATE - 30
        GROUP BY snapshot_date
      `);
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('42883');
  });

  // ── Bug 2: sessions has no tenant_id; count through the user's workspace ──
  it('runs the fixed active-tenant join and returns a count', async () => {
    const res = await pool.query(`
      SELECT COUNT(DISTINCT u.last_tenant_id) as count
      FROM public.sessions s
      JOIN users u ON u.id = s.user_id
      JOIN tenants t ON t.id = u.last_tenant_id
      WHERE s.created_at > now() - interval '24 hours'
    `);
    expect(Number.isFinite(Number(res.rows[0]?.count))).toBe(true);
  });

  it('proves the pre-fix sessions.tenant_id metric rejects with 42703', async () => {
    let code: string | undefined;
    try {
      await pool.query(`SELECT COUNT(DISTINCT tenant_id) FROM public.sessions`);
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('42703');
  });

  it('keeps the columns the metric is built from, and tenant_members out of it', async () => {
    const cols = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name = 'sessions'
              OR (table_name = 'users' AND column_name = 'last_tenant_id'))`,
    );
    const names = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    expect(names.has('users.last_tenant_id')).toBe(true);
    // sessions must stay tenant-free, otherwise the metric should read it
    // directly instead of going through the user's active workspace.
    expect(names.has('sessions.tenant_id')).toBe(false);
  });

  // ── Bug 3: trial-check marker needs the platform context ──────────────────
  it('denies the tenant-scoped trial marker on an empty-GUC connection (42501)', async () => {
    const client = await borrowRlsClient();
    try {
      let code: string | undefined;
      try {
        await client.query(TRIAL_WARNING_INSERT, [TEST_TENANT_ID]);
      } catch (err) {
        code = (err as { code?: string }).code;
      }
      // This is the swallowed half of the bug: the INSERT never committed, so no
      // tenant was ever marked and every run re-mailed everyone.
      expect(code).toBe('42501');
    } finally {
      await client.query('RESET ALL').catch(() => {});
      client.release();
    }
  });

  it('accepts the trial marker once app.is_super_admin is set for the transaction', async () => {
    const client = await borrowRlsClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.is_super_admin', 'true', true)`);
      const res = await client.query(TRIAL_WARNING_INSERT, [TEST_TENANT_ID]);
      expect(res.rowCount).toBe(1);
      // Roll back: this test proves the WITH CHECK now admits the write, it must
      // not leave a committed marker for the dedup-visibility test to double-count.
      await client.query('ROLLBACK');
    } finally {
      await client.query('RESET ALL').catch(() => {});
      client.release();
    }
  });

  it('hides a committed trial marker from a context-less read and reveals it with the platform context', async () => {
    const client = await borrowRlsClient();
    try {
      await client.query(`SELECT set_config('app.is_super_admin', 'true', false)`);
      await client.query(TRIAL_WARNING_INSERT, [TEST_TENANT_ID]);

      await client.query('RESET ALL');
      await client.query(`SET ROLE ${RLS_TEST_ROLE}`);
      const hidden = await client.query(
        `SELECT count(*)::int AS c FROM activities
         WHERE event_type = 'trial_warning' AND tenant_id = $1 AND created_at > now() - interval '4 days'`,
        [TEST_TENANT_ID],
      );
      // The invisible marker is the half that caused repeat emails: notExists
      // always found nothing, so dedup never fired.
      expect(hidden.rows[0].c).toBe(0);

      await client.query(`SELECT set_config('app.is_super_admin', 'true', false)`);
      const shown = await client.query(
        `SELECT count(*)::int AS c FROM activities
         WHERE event_type = 'trial_warning' AND tenant_id = $1 AND created_at > now() - interval '4 days'`,
        [TEST_TENANT_ID],
      );
      expect(shown.rows[0].c).toBe(1);
    } finally {
      await client.query('RESET ALL').catch(() => {});
      client.release();
    }
  });
});
