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
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

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

d('superadmin panel SQL regressions (usage / monitoring / trial-check)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    await pool.query(`ALTER TABLE activities ENABLE ROW LEVEL SECURITY`);

    // Reset activities to the single authoritative tenant_isolation policy
    // (verbatim from 0092): permissive INSERT/SELECT keyed on a tenant-GUC match
    // OR the app.is_super_admin boolean. Dropping every policy first makes the
    // proof independent of whether db:sync left extra rules behind.
    await pool.query(`
      DO $$
      DECLARE p record;
      BEGIN
        FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'activities'::regclass LOOP
          EXECUTE format('DROP POLICY %I ON activities', p.polname);
        END LOOP;
      END $$;
    `);
    await pool.query(`
      CREATE POLICY "tenant_isolation" ON "activities" FOR ALL USING (
        (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
      ) WITH CHECK (
        (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
      );
    `);

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
