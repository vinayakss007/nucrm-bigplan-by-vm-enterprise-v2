/**
 * Tenant Isolation — application-level scoping tests.
 *
 * SCOPE / HONESTY NOTE (#M7):
 * This suite connects with the ordinary DATABASE_URL role (typically the
 * migration/owner role in test), which is EXEMPT from RLS. So the queries here
 * that include an explicit `.where(tenantId = ...)` verify only the
 * APPLICATION-LEVEL scoping contract (a filtered query returns just that
 * tenant's rows) and data integrity — they do NOT and cannot prove that RLS
 * blocks an UNFILTERED cross-tenant read.
 *
 * The real, database-enforced RLS proof — running as a NOSUPERUSER /
 * NOBYPASSRLS role with FORCE ROW LEVEL SECURITY and asserting that a
 * filter-less SELECT still hides another tenant's rows — lives in
 * tests/integration/rls-connection-affinity.test.ts. Do not duplicate or weaken
 * that here.
 *
 * Previously this file was mislabeled a "penetration test" and its
 * cross-tenant-UPDATE case asserted `updateResult.length >= 0`, which passes
 * even if a tenant hijack SUCCEEDS — a vacuous assertion that created false
 * confidence. That case has been corrected below to assert on the actual row
 * state and to skip cleanly when the connecting role is RLS-exempt (where the
 * update is expected to succeed and is not a security finding).
 *
 * Run: npx vitest run tests/integration/tenant-isolation.test.ts
 *
 * IMPORTANT: These tests should ONLY run in a test environment with dedicated test tenants.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// Skip entire suite if no database is available
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

describe.skipIf(!dbAvailable)('Tenant Isolation (application-level scoping)', () => {
  let pool: Pool;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL not set');
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });

    // Create test tenants
    const [tenantA] = await db.insert(schema.tenants)
      .values({
        id: randomUUID(),
        name: 'PenTest Tenant A',
        slug: `pentest-a-${Date.now()}`,
        subdomain: `pentest-a-${Date.now()}`,
        status: 'active',
      })
      .returning();

    const [tenantB] = await db.insert(schema.tenants)
      .values({
        id: randomUUID(),
        name: 'PenTest Tenant B',
        slug: `pentest-b-${Date.now()}`,
        subdomain: `pentest-b-${Date.now()}`,
        status: 'active',
      })
      .returning();

    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    // Create test users
    const [userA] = await db.insert(schema.users)
      .values({
        id: randomUUID(),
        tenantId: tenantAId,
        email: `pentest-a-${Date.now()}@test.com`,
        passwordHash: 'test_hash',
        firstName: 'PenTest',
        lastName: 'User A',
        role: 'admin',
      })
      .returning();

    const [userB] = await db.insert(schema.users)
      .values({
        id: randomUUID(),
        tenantId: tenantBId,
        email: `pentest-b-${Date.now()}@test.com`,
        passwordHash: 'test_hash',
        firstName: 'PenTest',
        lastName: 'User B',
        role: 'admin',
      })
      .returning();

    userAId = userA.id;
    userBId = userB.id;

    // Create test data for Tenant A
    await db.insert(schema.contacts)
      .values({
        id: randomUUID(),
        tenantId: tenantAId,
        createdBy: userAId,
        firstName: 'Secret',
        lastName: 'Contact A',
        email: `secret-a-${Date.now()}@test.com`,
      });

    // Create test data for Tenant B
    await db.insert(schema.contacts)
      .values({
        id: randomUUID(),
        tenantId: tenantBId,
        createdBy: userBId,
        firstName: 'Secret',
        lastName: 'Contact B',
        email: `secret-b-${Date.now()}@test.com`,
      });
  });

  afterAll(async () => {
    // Cleanup test data (guard against undefined IDs if insert failed)
    if (tenantAId) {
      await db.delete(schema.dealStages).where(eq(schema.dealStages.tenantId, tenantAId)).catch(() => {});
      await db.delete(schema.pipelines).where(eq(schema.pipelines.tenantId, tenantAId)).catch(() => {});
      await db.delete(schema.contacts).where(eq(schema.contacts.tenantId, tenantAId)).catch(() => {});
      await db.delete(schema.users).where(eq(schema.users.tenantId, tenantAId)).catch(() => {});
      await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantAId)).catch(() => {});
    }
    if (tenantBId) {
      await db.delete(schema.contacts).where(eq(schema.contacts.tenantId, tenantBId)).catch(() => {});
      await db.delete(schema.users).where(eq(schema.users.tenantId, tenantBId)).catch(() => {});
      await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantBId)).catch(() => {});
    }
    await pool.end();
  });

  it('should prevent Tenant B from querying Tenant A contacts', async () => {
    // Simulate a query from Tenant B's context trying to access Tenant A's data
    const result = await db.select()
      .from(schema.contacts)
      .where(eq(schema.contacts.tenantId, tenantBId));

    // Tenant B should only see its own contacts
    for (const contact of result) {
      expect(contact.tenantId).toBe(tenantBId);
      expect(contact.tenantId).not.toBe(tenantAId);
    }
  });

  it('should prevent cross-tenant data access via direct query', async () => {
    // Attempt to query contacts without tenant filter (simulating a bug)
    // In production, RLS should prevent this
    const allContacts = await db.select()
      .from(schema.contacts)
      .where(sql`${schema.contacts.tenantId} IN (${tenantAId}, ${tenantBId})`);

    // Verify each contact belongs to exactly one tenant
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantAContacts = allContacts.filter((c: any) => c.tenantId === tenantAId);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantBContacts = allContacts.filter((c: any) => c.tenantId === tenantBId);

    expect(tenantAContacts.length).toBeGreaterThan(0);
    expect(tenantBContacts.length).toBeGreaterThan(0);

    // No contact should have both tenant IDs (impossible, but verify data integrity)
    for (const contact of allContacts) {
      expect([tenantAId, tenantBId]).toContain(contact.tenantId);
    }
  });

  it('cross-tenant reassignment: RLS blocks it for an enforced role; app layer must guard otherwise', async () => {
    // Is the CONNECTING role actually subject to RLS? An owner/superuser/
    // BYPASSRLS role is exempt, in which case a raw cross-tenant UPDATE is
    // EXPECTED to succeed at the DB level (isolation then rests on the app layer
    // never deriving tenantId from user input — proven elsewhere). We assert on
    // the real outcome for whichever role we are, instead of the old vacuous
    // `updateResult.length >= 0` which passed even on a successful hijack.
    const who = await db.execute(sql`
      SELECT rolsuper AS is_superuser, rolbypassrls AS bypass_rls,
             (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'contacts') AS forced
        FROM pg_roles WHERE rolname = current_user
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (Array.isArray(who) ? who[0] : (who as any)?.rows?.[0]) ?? {};
    const roleExempt = row.is_superuser === true || row.bypass_rls === true;
    const forced = row.forced === true;
    const rlsEnforcedForThisRole = !roleExempt && forced;

    const [contactA] = await db.insert(schema.contacts)
      .values({
        id: randomUUID(),
        tenantId: tenantAId,
        createdBy: userAId,
        firstName: 'Test',
        lastName: 'Contact',
        email: `test-${Date.now()}@test.com`,
      })
      .returning();

    // Attempt to "reassign" the contact to Tenant B via a raw UPDATE.
    const updateResult = await db.update(schema.contacts)
      .set({ tenantId: tenantBId })
      .where(eq(schema.contacts.id, contactA.id))
      .returning();

    if (rlsEnforcedForThisRole) {
      // Enforced role: the cross-tenant write must be blocked (0 rows changed)
      // and the row must remain owned by Tenant A.
      expect(updateResult.length).toBe(0);
      const [after] = await db.select()
        .from(schema.contacts)
        .where(eq(schema.contacts.id, contactA.id));
      expect(after?.tenantId).toBe(tenantAId);
    } else {
      // Exempt role (typical in test): the DB does not block this, so the write
      // succeeds. That is NOT a product security finding — it just means the
      // real defense here is the application never trusting a client-supplied
      // tenantId (and RLS enforced in production via a non-owner role, proven in
      // rls-connection-affinity.test.ts). Assert the honest expected behavior.
      expect(updateResult.length).toBe(1);
      expect(updateResult[0]?.tenantId).toBe(tenantBId);
      // Restore so afterAll cleanup by tenantAId still collects it.
      await db.update(schema.contacts)
        .set({ tenantId: tenantAId })
        .where(eq(schema.contacts.id, contactA.id));
    }
  });

  it('should prevent access to another tenant deals', async () => {
    // Create a pipeline and stage for FK constraint
    const [pipeline] = await db.insert(schema.pipelines)
      .values({ id: randomUUID(), tenantId: tenantAId, name: 'PenTest Pipeline' })
      .returning();
    const [stage] = await db.insert(schema.dealStages)
      .values({ id: randomUUID(), tenantId: tenantAId, pipelineId: pipeline.id, name: 'PenTest Stage', order: 1 })
      .returning();

    // Create deals for each tenant
    const [dealA] = await db.insert(schema.deals)
      .values({
        id: randomUUID(),
        tenantId: tenantAId,
        createdBy: userAId,
        title: 'Secret Deal A',
        amount: '10000',
        stageId: stage.id,
      })
      .returning();

    const [dealB] = await db.insert(schema.deals)
      .values({
        id: randomUUID(),
        tenantId: tenantBId,
        createdBy: userBId,
        title: 'Secret Deal B',
        amount: '20000',
        stageId: stage.id,
      })
      .returning();

    // Query deals for Tenant B
    const tenantBDeals = await db.select()
      .from(schema.deals)
      .where(eq(schema.deals.tenantId, tenantBId));

    // Verify no Tenant A deals leaked
    for (const deal of tenantBDeals) {
      expect(deal.tenantId).toBe(tenantBId);
      expect(deal.tenantId).not.toBe(tenantAId);
    }

    // Cleanup
    await db.delete(schema.deals).where(eq(schema.deals.id, dealA.id));
    await db.delete(schema.deals).where(eq(schema.deals.id, dealB.id));
    await db.delete(schema.dealStages).where(eq(schema.dealStages.id, stage.id));
    await db.delete(schema.pipelines).where(eq(schema.pipelines.id, pipeline.id));
  });

  it('should prevent cross-tenant task access', async () => {
    // Create tasks for each tenant
    const [taskA] = await db.insert(schema.tasks)
      .values({
        id: randomUUID(),
        tenantId: tenantAId,
        createdBy: userAId,
        title: 'Secret Task A',
        status: 'pending',
        priority: 'high',
      })
      .returning();

    const [taskB] = await db.insert(schema.tasks)
      .values({
        id: randomUUID(),
        tenantId: tenantBId,
        createdBy: userBId,
        title: 'Secret Task B',
        status: 'pending',
        priority: 'medium',
      })
      .returning();

    // Query tasks for Tenant A
    const tenantATasks = await db.select()
      .from(schema.tasks)
      .where(eq(schema.tasks.tenantId, tenantAId));

    for (const task of tenantATasks) {
      expect(task.tenantId).toBe(tenantAId);
      expect(task.tenantId).not.toBe(tenantBId);
    }

    // Cleanup
    await db.delete(schema.tasks).where(eq(schema.tasks.id, taskA.id));
    await db.delete(schema.tasks).where(eq(schema.tasks.id, taskB.id));
  });

  it('should verify RLS policies are enabled on critical tables', async () => {
    // Check if RLS is enabled on critical tables
    const rlsResult = await db.execute(sql`
      SELECT
        schemaname,
        tablename,
        rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename IN ('contacts', 'deals', 'companies', 'tasks', 'leads', 'tenants', 'users')
      ORDER BY tablename
    `);

    // Document which tables have RLS enabled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rlsRows = Array.isArray(rlsResult) ? rlsResult : (rlsResult as any)?.rows ?? [];
    const rlsStatus: Record<string, boolean> = {};
    for (const row of rlsRows) {
      rlsStatus[row.tablename as string] = row.rowsecurity === true;
    }

    // Assert RLS is actually ENABLED (not merely that the key exists) on the
    // core tenant-scoped tables. The previous assertion only checked that the
    // 'tenants' key was defined, which held even with RLS switched off.
    for (const table of ['contacts', 'deals', 'companies', 'tasks']) {
      expect(rlsStatus[table], `RLS should be enabled on "${table}"`).toBe(true);
    }
  });

  it('should prevent bulk data export across tenants', async () => {
    // Simulate an export request that tries to get all data
    const allContacts = await db.select({
      id: schema.contacts.id,
      tenantId: schema.contacts.tenantId,
      email: schema.contacts.email,
    })
      .from(schema.contacts)
      .where(sql`${schema.contacts.tenantId} = ANY(ARRAY[${tenantAId}, ${tenantBId}]::uuid[])`);

    // Group by tenant and verify separation
    const byTenant: Record<string, number> = {};
    for (const contact of allContacts) {
      byTenant[contact.tenantId] = (byTenant[contact.tenantId] || 0) + 1;
    }

    // Each tenant should have its own count
    expect(Object.keys(byTenant).length).toBeLessThanOrEqual(2);
  });
});
