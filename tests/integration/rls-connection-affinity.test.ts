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
 * it must be correct for CI where Postgres + the RLS migrations are present.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../../drizzle/db';
import { setTenantContext } from '../../lib/db/rls';
import { withPinnedConnection } from '../../lib/db/request-connection';
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
  });

  afterAll(async () => {
    // Cleanup uses raw context set to each tenant so RLS permits the deletes.
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
  });

  it("a request's OWN tenant context is visible to its later db queries (connection affinity)", async () => {
    // This is the assertion that FAILS on the unfixed code: without pinning, the
    // raw unfiltered SELECT after a no-tx setTenantContext runs on a different
    // pooled connection with an empty GUC → fail-closed → ZERO rows → tenant A's
    // own row would be MISSING.
    await withPinnedConnection(async () => {
      await setTenantContext(tenantAId, userAId);

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
    await withPinnedConnection(async () => {
      await setTenantContext(tenantAId, userAId);

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
});
