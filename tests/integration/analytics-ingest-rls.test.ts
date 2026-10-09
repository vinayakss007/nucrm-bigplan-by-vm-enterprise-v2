/**
 * Analytics ingest RLS proving test.
 *
 * WHAT THIS PROVES
 * ----------------
 * POST /api/track/event writes analytics rows from the ORDINARY app pool: no
 * app.current_tenant GUC is set (append-only telemetry needs no tenant
 * pinning), and anonymous visitors legitimately carry tenant_id NULL. Since
 * 0088 that exact shape was rejected: its analytics_events_insert policy
 * required either a GUC tenant match or super-admin + NULL, so EVERY ingest
 * insert died with 42501 and the product-analytics stream was silently dead.
 * Migration 0096 restores the append-only-telemetry precedent (permissive
 * INSERT like error_logs/security_events) while keeping READS strict.
 *
 * This test runs the real statements under a NOSUPERUSER/NOBYPASSRLS role with
 * EMPTY GUCs and asserts:
 *   1. the tenant-less (NULL tenant_id) ingest insert SUCCEEDS, and
 *   2. a filter-less SELECT still sees ZERO rows (reads remain fail-closed).
 *
 * Like tests/integration/rls-connection-affinity.test.ts, it self-skips when
 * no database is reachable and idempotently (re)establishes the exact policy
 * preconditions so the proof holds whether the schema came from db:sync or a
 * full db:migrate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { dropRlsProbeRole, ensureRlsProbeRole, withOwnerSession } from '../helpers/rls-probe-role-2474';

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

const RLS_TEST_ROLE = 'analytics_ingest_rls_test_role';
const TEST_ANON_ID = `rls-test-${randomUUID()}`;

d('analytics_events ingest RLS (migration 0096)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // tests/helpers/rls-probe-role-2474.ts, and not a GRANT on an object: `GRANT USAGE ON
    // SCHEMA public` is an UPDATE of one hot pg_namespace row that four suites
    // were racing in the same second, which is how CI started dying in whichever
    // suite lost (#2474). Membership gives this probe SELECT/INSERT on
    // analytics_events — and no TRUNCATE it does not ask for — while staying
    // NOBYPASSRLS, so the 0096 permissive INSERT policy is still what decides.
    //
    // Over `withOwnerSession`, not `pool.query`: `GRANT … TO CURRENT_USER` is only
    // the owner's to issue, and a pooled connection can arrive wearing a previous
    // test's role, because `role` survives `RESET ALL` (measured on PG16).
    await withOwnerSession(() => pool.connect(), (runDdl) => ensureRlsProbeRole(runDdl, RLS_TEST_ROLE));
    await pool.query(`ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY`);

    // Recreate the authoritative policy pair verbatim: the strict FOR ALL read
    // isolation from 0088 (untouched by the fix) + the 0096 permissive insert.
    await pool.query(`
      DROP POLICY IF EXISTS "tenant_isolation" ON "analytics_events";
      CREATE POLICY "tenant_isolation" ON "analytics_events" FOR ALL USING (
        (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        OR ((NULLIF(current_setting('app.is_super_admin', true), ''))::boolean = true)
      );
    `);
    await pool.query(`
      DROP POLICY IF EXISTS "analytics_events_insert" ON "analytics_events";
      CREATE POLICY "analytics_events_insert" ON "analytics_events" FOR INSERT WITH CHECK (true);
    `);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM analytics_events WHERE anon_id = $1`, [TEST_ANON_ID]).catch(() => {});
    // This suite used to leave its probe role in the cluster. A role that appears
    // in no object ACL drops cleanly, so there is no reason to hand the next run
    // a role whose attributes it has to guess (#2466, #2474).
    await withOwnerSession(() => pool.connect(), (runDdl) => dropRlsProbeRole(runDdl, RLS_TEST_ROLE));
    await pool.end().catch(() => {});
  });

  it('accepts a tenant-less ingest insert on an empty-GUC connection', async () => {
    const client = await pool.connect();
    try {
      // RESET ROLE, not RESET ALL: `role` survives RESET ALL (measured on PG16),
      // so a connection borrowed here can arrive wearing a previous test's role
      // and only RESET ROLE puts it back to the owner.
      await client.query(`RESET ROLE`);
      await client.query(`RESET ALL`);
      await client.query(`SET ROLE ${RLS_TEST_ROLE}`);
      // Exactly what lib/analytics/store.ts writes for an anonymous page_view.
      await client.query(
        `INSERT INTO analytics_events (tenant_id, user_id, anon_id, event_name, properties, url, referrer, session_id, is_paid, plan_id)
         VALUES (NULL, NULL, $1, 'page_view', '{}'::jsonb, '/tenant/leaderboards', '', 's-1', false, NULL)`,
        [TEST_ANON_ID],
      );
    } finally {
      // Release it as the owner it came in as. Leaving a role-wearing connection in
      // the pool is what made the teardown `DROP ROLE` fail with `permission denied
      // to drop role`, with every assertion in this file green.
      await client.query(`RESET ROLE`).catch(() => {});
      await client.query(`RESET ALL`).catch(() => {});
      client.release();
    }
  });

  it('still denies filter-less reads on the same connection shape', async () => {
    const client = await pool.connect();
    try {
      await client.query(`RESET ROLE`);
      await client.query(`RESET ALL`);
      await client.query(`SET ROLE ${RLS_TEST_ROLE}`);
      const { rows } = await client.query(
        `SELECT 1 FROM analytics_events WHERE anon_id = $1`,
        [TEST_ANON_ID],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query(`RESET ROLE`).catch(() => {});
      await client.query(`RESET ALL`).catch(() => {});
      client.release();
    }
  });
});
