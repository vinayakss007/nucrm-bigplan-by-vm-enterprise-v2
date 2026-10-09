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
 * on a dedicated NOSUPERUSER/NOBYPASSRLS/NOINHERIT role with EMPTY GUCs, and
 * self-establishes the authoritative activities tenant_isolation policy (from
 * 0092, a FOR ALL policy whose USING/WITH CHECK admit either a tenant-GUC match
 * or the app.is_super_admin boolean) so the proof holds whether the schema came
 * from db:sync or a full db:migrate. Like
 * tests/integration/analytics-ingest-rls.test.ts it self-skips when no database
 * is reachable and cleans up every row it writes.
 *
 * WHAT IT LEAVES BEHIND (#2455)
 * -----------------------------
 * That self-establishment used to be destructive: the file ENABLEd RLS, DROPped
 * EVERY policy on activities — including ones it did not create — and re-CREATEd
 * a hand-typed copy under the shipped name. It did that on purpose, "to make the
 * proof independent of whether db:sync left extra rules behind", but the cost
 * was that a policy a future migration adds to activities would be deleted here,
 * silently, on every database this suite touches, while the proof still passed on
 * its own copy. The role and its grants leaked too, and the hand-typed copy meant
 * the suite could keep proving an arm the migration no longer ships.
 *
 * Now: the state is captured before anything is changed, the shipped object is
 * read out of 0092 rather than retyped (tests/helpers/shipped-rls-policy.ts), a
 * policy is installed only when the database does not already admit the
 * super-admin bypass, the fixture carries its own name so it can never overwrite
 * a shipped one, and teardown removes exactly what was added, revokes the grants
 * and drops the role — but only the role this run created. A role that was
 * already in the cluster is left alone and reported, because DROP ROLE is
 * cluster-wide while the grants here are per-database (#2466). A restore that
 * fails is thrown, not swallowed — the same discipline
 * rls-connection-affinity.test.ts adopted in #2451.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { readShippedPolicy, admitsSuperAdmin, type CapturedPolicy } from '../helpers/shipped-rls-policy';

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
// The fixture is NEVER installed under 0092's name: writing a shipped object's
// name is how this file used to replace the database's own policy with its
// private copy (#2455). Under its own name it can only ever be added, and only
// ever removed by the code that added it.
const FIXTURE_POLICY_NAME = 'superadmin_panel_sql_fixture_isolation';
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
 * The RLS state as it was found. `CapturedPolicy` is the `pg_policies` row shape
 * from the helper; `qual`/`with_check` there are the engine's own deparse of the
 * arms, which is valid input for a `USING (…)` / `WITH CHECK (…)` clause — that
 * is what makes a restore faithful rather than a re-interpretation (#2451).
 */
type CapturedRls = { enabled: boolean; forced: boolean; policies: CapturedPolicy[] };

d('superadmin panel SQL regressions (usage / monitoring / trial-check)', () => {
  let pool: Pool;
  // Everything this file found before it changed anything. Restoring is defined
  // against these values, never against a guess at what the schema "should" be.
  let activitiesBefore: CapturedRls = { enabled: false, forced: false, policies: [] };
  let enabledRlsHere = false;
  let installedFixture = false;
  // Whether the ROLE is ours to remove at the end. Set in beforeAll from what the
  // cluster already had, before this file grants anything.
  let roleCreatedHere = false;

  async function captureActivitiesRls(): Promise<CapturedRls> {
    // Scoped by the relation's OID and the policy's schema+table: joining
    // pg_class on relname alone would also pick up a same-named table in another
    // schema. relforcerowsecurity has existed since 9.5, so no version probe.
    const { rows: cls } = await pool.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE oid = 'activities'::regclass`,
    );
    const { rows: policies } = await pool.query(
      `SELECT policyname AS name, cmd, permissive, roles::text[] AS roles,
              qual, with_check AS "withCheck"
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'activities'
        ORDER BY policyname`,
    );
    return {
      enabled: Boolean(cls[0]?.enabled),
      forced: Boolean(cls[0]?.forced),
      policies: policies as CapturedPolicy[],
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Ask the cluster who owned this role before we had it. Roles are cluster-wide
    // while every grant below is per-database, so a role that is already here
    // belongs to another run — or to another database's leftovers — and this file
    // has no claim on removing it (#2466).
    const roleFound = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [RLS_TEST_ROLE]);
    roleCreatedHere = (roleFound.rowCount ?? 0) === 0;

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

    // Capture FIRST — anything read after the mutations below is this file's own
    // handiwork, and a snapshot taken then restores the fixture instead of the
    // database.
    activitiesBefore = await captureActivitiesRls();

    if (!activitiesBefore.enabled) {
      await pool.query(`ALTER TABLE activities ENABLE ROW LEVEL SECURITY`);
      enabledRlsHere = true;
    }

    // The proof needs a policy that admits the platform GUC for both the read and
    // the insert. If the schema already ships one (any database built through the
    // migrations), USE IT and change nothing. Only a schema that has no policies
    // at all — `db:sync`/drizzle-kit push, which is what CI provisions — gets a
    // fixture, and the fixture is the statement 0092 itself builds, read out of
    // the migration file rather than typed into this file. If that migration ever
    // drops the app.is_super_admin arm, readShippedPolicy() throws and this suite
    // fails, instead of quietly re-adding the bypass it is supposed to be testing.
    const bypass = admitsSuperAdmin(activitiesBefore.policies);
    if (!bypass.reads || !bypass.writes) {
      await pool.query(readShippedPolicy().statementFor('activities', FIXTURE_POLICY_NAME));
      installedFixture = true;
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
    const failures: string[] = [];

    // FK order: activities are cascaded by the tenant delete, but remove them
    // explicitly so a partial run cannot strand a marker row.
    await pool.query(`DELETE FROM activities WHERE tenant_id = $1`, [TEST_TENANT_ID]).catch(() => {});
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TEST_TENANT_ID]).catch(() => {});

    // Remove exactly what beforeAll added, in one transaction: Postgres DDL is
    // transactional, so another file reading activities in the middle of teardown
    // never sees the table with the fixture dropped and RLS still enabled, and a
    // restore that fails halfway leaves the table as it was rather than half-done.
    const client = await pool.connect();
    try {
      await client.query('RESET ALL');
      await client.query('BEGIN');
      if (installedFixture) {
        await client.query(`DROP POLICY IF EXISTS "${FIXTURE_POLICY_NAME}" ON activities`);
      }
      if (enabledRlsHere) {
        await client.query(`ALTER TABLE activities DISABLE ROW LEVEL SECURITY`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      failures.push(`rls restore: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }

    // The role this file creates is its own to remove; leaving it behind is a
    // grant that outlives the test that needed it. A role it did not create is
    // somebody else's, and mutating one costs two things: the revokes would strip
    // grants a concurrent run is reading through, and DROP ROLE is cluster-wide, so
    // it fails while ANY other database holds an object or a grant for the role —
    // which turned this file red over a fact about the cluster rather than about
    // the SQL it proves (#2466). A pre-existing role keeps its grants; the run
    // that created it is the one responsible for taking them back.
    if (roleCreatedHere) {
      for (const stmt of [
        `REVOKE SELECT, INSERT ON activities FROM ${RLS_TEST_ROLE}`,
        `REVOKE USAGE ON SCHEMA public FROM ${RLS_TEST_ROLE}`,
        `REVOKE ${RLS_TEST_ROLE} FROM CURRENT_USER`,
        `DROP ROLE IF EXISTS ${RLS_TEST_ROLE}`,
      ]) {
        try {
          await pool.query(stmt);
        } catch (err) {
          failures.push(`${stmt.split(' ')[0]}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      // Reported, not failed — pre-existence is not a restore this file owes.
      console.warn(
        `[superadmin-panel-sql] role "${RLS_TEST_ROLE}" already existed before this run, so it was ` +
          `left in place along with its grants (DROP ROLE is cluster-wide; see #2466)`,
      );
    }

    // Nothing this file was not supposed to touch may have gone missing. The old
    // version DROPped every policy and proved only its own copy, so a policy a
    // later migration adds would vanish here with the suite still green.
    const after = await captureActivitiesRls();
    const missing = activitiesBefore.policies
      .map((p) => p.name)
      .filter((name) => name !== FIXTURE_POLICY_NAME && !after.policies.some((p) => p.name === name));
    if (missing.length > 0) {
      failures.push(`policies destroyed by this suite: ${missing.join(', ')}`);
    }
    if (failures.length > 0) {
      // A failed restore is reported instead of swallowed: `.catch(() => {})` over
      // these statements is why the destroyed-policy version survived CI at all.
      throw new Error(
        `superadmin-panel-sql could not leave the database as it found it: ${failures.join(' | ')}`,
      );
    }

    await pool.end().catch(() => {});
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
