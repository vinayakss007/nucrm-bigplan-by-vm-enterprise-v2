/**
 * RLS Connection-Affinity Proving Test (#1615)
 *
 * WHAT THIS PROVES
 * ----------------
 * This test exercises the REAL application data layer — the global `db` proxy
 * from '@/drizzle/db', setTenantContext() from '@/lib/db/rls', and the new
 * withPinnedConnection() from '@/lib/db/request-connection' — against a live
 * Postgres that has the RLS migrations applied. It does NOT construct a bare
 * local pool for the assertions under test; that is the whole point, because the
 * bug (#1615) lives in how the shared pool hands out connections.
 *
 * ROOT CAUSE (pre-fix)
 * --------------------
 * The global `db` is a Proxy over drizzle(getPool()). Each top-level
 * db.execute/db.select checks out a FRESH pooled connection and releases it
 * immediately — there is NO connection affinity across a request.
 * setTenantContext(no tx) sets app.current_tenant as a SESSION GUC
 * (is_local=false) on whatever connection that ONE statement grabbed, which is
 * then released (and reset by pool.on('release')). A subsequent
 * `db.execute(SELECT ... FROM contacts)` (with NO app-level tenant_id filter)
 * runs on a DIFFERENT connection whose GUC is empty, so the fail-closed RLS
 * policy (migration 0039) denies EVERY row.
 *
 * WHY IT FAILS WITHOUT THE FIX
 * ----------------------------
 * Inside withPinnedConnection(): pre-fix, withPinnedConnection did not exist /
 * the `db` proxy always routed to the pool. So:
 *   - setTenantContext(tenantA) sets the GUC on connection C1, released at once.
 *   - the raw unfiltered `SELECT id, tenant_id FROM contacts` runs on C2 with an
 *     empty GUC → fail-closed policy → ZERO rows.
 *   => assertion "tenant A's row IS returned" FAILS (got 0 rows).
 *
 * WHY IT PASSES WITH THE FIX
 * --------------------------
 * withPinnedConnection() pins ONE PoolClient for the scope and the `db` proxy
 * routes every query to it. setTenantContext(tenantA) sets the SESSION GUC on the
 * pinned client; the later raw unfiltered SELECT runs on that SAME client, so the
 * GUC is present:
 *   - tenant A's row IS visible (own-tenant context works), AND
 *   - tenant B's row is NOT visible even though there is NO app-level tenant_id
 *     filter on the query — RLS alone blocks the cross-tenant read.
 *
 * If DATABASE_URL is unreachable the suite self-skips (acceptable in the sandbox);
 * it must be correct for CI where a live Postgres is present.
 *
 * WHY THIS TEST ESTABLISHES ITS OWN RLS PRECONDITIONS
 * ---------------------------------------------------
 * CI provisions the schema with `npm run db:sync` (drizzle-kit push), which
 * syncs only the TABLE structure (columns/indexes/constraints). It does NOT run
 * the hand-written SQL migration files, so the RLS objects those migrations
 * create are ABSENT in the CI database:
 *   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`     (0037_tenant_isolation_hardening)
 *   - the fail-closed `tenant_isolation` policy       (0037 / 0039_rls_fail_closed_policy)
 *   - `ALTER TABLE ... FORCE ROW LEVEL SECURITY`       (0068_force_rls_owner)
 * With no RLS enabled and no policy, a filter-less `SELECT * FROM contacts`
 * returns EVERY tenant's rows, so an isolation assertion cannot hold. This test
 * therefore idempotently (re)creates those exact preconditions on the tables it
 * queries before asserting, so the proof is valid regardless of how the schema
 * was provisioned (db:sync in CI, or full db:migrate in prod).
 *
 * WHY THE ASSERTIONS RUN UNDER A NON-SUPERUSER ROLE
 * -------------------------------------------------
 * PostgreSQL EXEMPTS superusers and roles with BYPASSRLS from all RLS policies
 * — even with FORCE ROW LEVEL SECURITY set. CI connects as the `postgres`
 * superuser (rolsuper = rolbypassrls = true), which would bypass RLS and make
 * the isolation assertions vacuously fail (all rows returned). Production runs
 * as an ordinary, non-owner application role that is subject to RLS. To prove
 * the guarantee that actually protects production, the filter-less assertion
 * queries run under a dedicated NOSUPERUSER / NOBYPASSRLS role (`SET ROLE`),
 * established on the same pinned connection the tenant GUC was set on. The
 * connection-affinity fix (the thing #1615 adds) is what makes the GUC visible
 * to that role's query; RLS then blocks the cross-tenant read.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../../drizzle/db';
import { setTenantContext } from '../../lib/db/rls';
import { withPinnedConnection } from '../../lib/db/request-connection';
import { withApiRoute } from '../../lib/api/with-api-route';
import * as schema from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

// Skip entire suite if no database is available (same pattern as tenant-isolation.test.ts)
async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  // The app pool guards against a missing/root username; PgBouncer must be OFF
  // for this test because the fix (and the bug) are specific to the plain
  // node-postgres pool path.
  if (process.env.PGBOUNCER_ENABLED === 'true') return false;
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

// A dedicated, ordinary application role that is SUBJECT to RLS (NOSUPERUSER,
// NOBYPASSRLS). The isolation assertions run under this role via SET ROLE
// because the CI connection role (`postgres`) is a superuser that bypasses RLS.
// The name is test-scoped and safe to (re)create idempotently.
const RLS_TEST_ROLE = 'rls_affinity_test_role';

// Tables this test issues filter-less reads against — the RLS preconditions and
// grants below are applied to exactly these.
const RLS_TABLES = ['contacts'] as const;

/**
 * Idempotently establish, on the connected database, the RLS preconditions that
 * production migrations create but `db:sync` (drizzle-kit push, what CI runs)
 * does NOT: enable + FORCE row level security and a fail-closed tenant_isolation
 * policy on the queried tables, plus a NOSUPERUSER/NOBYPASSRLS role that is
 * actually subject to those policies. Safe to run repeatedly and whether or not
 * the real migrations already applied these objects.
 */
async function ensureRlsPreconditions(): Promise<void> {
  // Non-superuser role that RLS applies to. DROP/CREATE would fail if the role
  // owns objects, so create-if-absent instead.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_affinity_test_role') THEN
        CREATE ROLE rls_affinity_test_role NOSUPERUSER NOBYPASSRLS NOINHERIT;
      ELSE
        ALTER ROLE rls_affinity_test_role NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);
  // The current (owner/superuser) role must be able to SET ROLE to it.
  await db.execute(sql`GRANT rls_affinity_test_role TO CURRENT_USER`);
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO rls_affinity_test_role`);

  for (const table of RLS_TABLES) {
    const tbl = sql.raw(`"${table}"`);
    await db.execute(sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`);
    // FORCE so the guarantee also holds for the table OWNER (production's app
    // role is a non-owner, but forcing keeps the policy authoritative here too).
    await db.execute(sql`ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY`);
    await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO rls_affinity_test_role`);
    // Fail-closed policy, mirroring migration 0039: empty/unset GUC -> NULL ->
    // deny; a valid uuid GUC -> equality; NULL tenant_id rows are global.
    await db.execute(sql`DROP POLICY IF EXISTS tenant_isolation ON ${tbl}`);
    await db.execute(sql`
      CREATE POLICY tenant_isolation ON ${tbl}
      FOR ALL
      USING (
        tenant_id IS NULL
        OR tenant_id = (
          CASE
            WHEN NULLIF(current_setting('app.current_tenant', true), '') IS NULL THEN NULL
            ELSE NULLIF(current_setting('app.current_tenant', true), '')::uuid
          END
        )
      )
    `);
  }
}

/**
 * Run `fn` inside a pinned connection with tenant context set AND the session
 * switched to the non-superuser RLS role, so the query is genuinely subject to
 * the tenant_isolation policy. RESET ROLE runs in a finally so the restricted
 * role never leaks back to the pool.
 */
async function withTenantAsRlsRole<T>(
  tenantId: string,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  return withPinnedConnection(async () => {
    await setTenantContext(tenantId, userId);
    await db.execute(sql.raw(`SET ROLE "${RLS_TEST_ROLE}"`));
    try {
      return await fn();
    } finally {
      await db.execute(sql`RESET ROLE`).catch(() => {});
    }
  });
}

describe.skipIf(!dbAvailable)('RLS connection affinity (#1615)', () => {
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;
  let contactAId: string;
  let contactBId: string;

  beforeAll(async () => {
    tenantAId = randomUUID();
    tenantBId = randomUUID();
    userAId = randomUUID();
    userBId = randomUUID();
    contactAId = randomUUID();
    contactBId = randomUUID();

    const now = Date.now();

    // Seed WITHOUT any tenant context set. These inserts use the raw SQL path so
    // they are not blocked by RLS on tables where INSERT is policy-checked; we
    // set the GUC per-insert via a transaction (is_local=true) to satisfy RLS.
    await db.execute(sql`
      SELECT set_config('app.current_tenant', ${tenantAId}, false),
             set_config('app.current_user', ${userAId}, false)
    `);

    await db.insert(schema.tenants).values({
      id: tenantAId,
      name: 'AffinityTest Tenant A',
      slug: `affinity-a-${now}`,
      subdomain: `affinity-a-${now}`,
      status: 'active',
    });
    await db.insert(schema.tenants).values({
      id: tenantBId,
      name: 'AffinityTest Tenant B',
      slug: `affinity-b-${now}`,
      subdomain: `affinity-b-${now}`,
      status: 'active',
    });

    await db.insert(schema.users).values({
      id: userAId,
      tenantId: tenantAId,
      email: `affinity-a-${now}@test.com`,
      passwordHash: 'test_hash',
      firstName: 'Affinity',
      lastName: 'User A',
      role: 'admin',
    });
    await db.insert(schema.users).values({
      id: userBId,
      tenantId: tenantBId,
      email: `affinity-b-${now}@test.com`,
      passwordHash: 'test_hash',
      firstName: 'Affinity',
      lastName: 'User B',
      role: 'admin',
    });

    await db.insert(schema.contacts).values({
      id: contactAId,
      tenantId: tenantAId,
      createdBy: userAId,
      firstName: 'Affinity',
      lastName: 'Contact A',
      email: `affinity-contact-a-${now}@test.com`,
    });
    await db.insert(schema.contacts).values({
      id: contactBId,
      tenantId: tenantBId,
      createdBy: userBId,
      firstName: 'Affinity',
      lastName: 'Contact B',
      email: `affinity-contact-b-${now}@test.com`,
    });

    // Reset the GUC so the seed context does not bleed into the assertions.
    await db.execute(sql`
      SELECT set_config('app.current_tenant', '', false),
             set_config('app.current_user', '', false)
    `);

    // Establish the RLS objects + non-superuser role the assertions rely on.
    // CI's db:sync does not apply the RLS migrations, so we (re)create them
    // here; this is idempotent when the real migrations already ran.
    await ensureRlsPreconditions();
  });

  afterAll(async () => {
    // Cleanup uses raw context set to each tenant so RLS permits the deletes.
    // Deletes run as the connection's owner/superuser role (not the restricted
    // RLS role), with the correct tenant GUC so the FORCE-RLS policy permits them.
    for (const [tid, uid, cid] of [
      [tenantAId, userAId, contactAId],
      [tenantBId, userBId, contactBId],
    ] as const) {
      if (!tid) continue;
      await withPinnedConnection(async () => {
        await setTenantContext(tid, uid);
        await db.delete(schema.contacts).where(eq(schema.contacts.id, cid)).catch(() => {});
        await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
        await db.delete(schema.tenants).where(eq(schema.tenants.id, tid)).catch(() => {});
      });
    }

    // Revert the RLS preconditions we established so this suite does not change
    // the shared DB state other integration test files observe. db:sync leaves
    // these tables with RLS OFF; restore that. (If the real migrations had RLS
    // on, a later db:migrate re-applies it — tests never run after migrate.)
    for (const table of RLS_TABLES) {
      const tbl = sql.raw(`"${table}"`);
      await db.execute(sql`DROP POLICY IF EXISTS tenant_isolation ON ${tbl}`).catch(() => {});
      await db.execute(sql`ALTER TABLE ${tbl} NO FORCE ROW LEVEL SECURITY`).catch(() => {});
      await db.execute(sql`ALTER TABLE ${tbl} DISABLE ROW LEVEL SECURITY`).catch(() => {});
      await db
        .execute(sql`REVOKE ALL ON ${tbl} FROM rls_affinity_test_role`)
        .catch(() => {});
    }
    await db.execute(sql`REVOKE USAGE ON SCHEMA public FROM rls_affinity_test_role`).catch(() => {});
    await db.execute(sql`DROP ROLE IF EXISTS rls_affinity_test_role`).catch(() => {});
  });

  it("a request's OWN tenant context is visible to its later db queries (connection affinity)", async () => {
    // This is the assertion that FAILS on the unfixed code: without pinning, the
    // raw unfiltered SELECT after a no-tx setTenantContext runs on a different
    // pooled connection with an empty GUC → fail-closed → ZERO rows → tenant A's
    // own row would be MISSING.
    await withTenantAsRlsRole(tenantAId, userAId, async () => {
      // RAW read with NO app-level tenant_id filter — RLS is the only gate.
      const result = await db.execute(
        sql`SELECT id, tenant_id FROM contacts`
      );
      const rows = (result.rows ?? []) as Array<{ id: string; tenant_id: string }>;

      const ids = rows.map((r) => r.id);
      expect(ids).toContain(contactAId); // own-tenant row IS visible (fails pre-fix)
    });
  });

  it('RLS blocks a cross-tenant read even with app-level filters removed (non-PgBouncer pool path)', async () => {
    await withTenantAsRlsRole(tenantAId, userAId, async () => {
      const result = await db.execute(
        sql`SELECT id, tenant_id FROM contacts`
      );
      const rows = (result.rows ?? []) as Array<{ id: string; tenant_id: string }>;

      // Every returned row belongs to tenant A only...
      for (const row of rows) {
        expect(row.tenant_id).toBe(tenantAId);
      }
      // ...and tenant B's contact is NOT present, despite no app-level filter.
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(contactBId);
    });
  });

  it('outside a pinned connection there is no pinned client (mechanism boundary)', async () => {
    const { getPinnedClient } = await import('../../lib/db/request-connection');
    expect(getPinnedClient()).toBeUndefined();
    await withPinnedConnection(async () => {
      expect(getPinnedClient()).toBeDefined();
    });
    expect(getPinnedClient()).toBeUndefined();
  });

  // REVIEW v1 FOLLOW-UP (#1615, review issue #2): drive an ACTUAL withApiRoute-
  // wrapped handler shaped exactly like a real route — auth sets the tenant
  // context, then the handler runs its OWN filter-LESS db query. This proves the
  // wrapper (not a hand-written withPinnedConnection block) makes RLS enforce
  // isolation on the handler-query surface #1615 is about.
  //
  // FAIL-WITHOUT-FIX: on the pre-fix code the handler body ran outside any pin,
  // so setTenantContext() landed on connection C1 (released at once) and the
  // handler's `SELECT ... FROM contacts` ran on C2 with an empty GUC → fail-
  // closed → ZERO rows → the "own row IS returned" assertion FAILS.
  // PASS-WITH-FIX: withApiRoute pins one client for the whole body, so the GUC
  // set during auth is visible to the handler's query.
  it('a withApiRoute-wrapped handler sees RLS-enforced isolation for its own filter-less query', async () => {
    // A route handler shaped like the real ones: "auth" sets tenant context,
    // then the handler issues a db query with NO app-level tenant_id filter.
    const handler = withApiRoute(async () => {
      // stands in for requireAuth() → setTenantContext(tenantA). We also switch
      // to the non-superuser application role here so the handler's query is
      // genuinely subject to RLS, exactly as production's non-owner DB role is
      // (the CI connection role is a superuser that would otherwise bypass RLS).
      await setTenantContext(tenantAId, userAId);
      await db.execute(sql.raw(`SET ROLE "${RLS_TEST_ROLE}"`));
      try {
        // the handler's OWN later query — RLS is the only gate here
        const result = await db.execute(sql`SELECT id, tenant_id FROM contacts`);
        const rows = (result.rows ?? []) as Array<{ id: string; tenant_id: string }>;
        return Response.json({ rows });
      } finally {
        await db.execute(sql`RESET ROLE`).catch(() => {});
      }
    });

    const res = await handler(
      new Request('http://test/api/tenant/contacts') as never,
      undefined as never
    );
    const { rows } = (await res.json()) as {
      rows: Array<{ id: string; tenant_id: string }>;
    };
    const ids = rows.map((r) => r.id);

    // own-tenant row visible (FAILS pre-fix: 0 rows)...
    expect(ids).toContain(contactAId);
    // ...cross-tenant row hidden despite no app-level filter (RLS alone)...
    expect(ids).not.toContain(contactBId);
    // ...and every returned row belongs to tenant A.
    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantAId);
    }
  });
});
