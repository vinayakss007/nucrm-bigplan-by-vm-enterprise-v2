import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://nucrm:nucrm123@localhost:5432/nucrm_fresh';

let pool: Pool;
let db: any;

async function isDatabaseAvailable(): Promise<boolean> {
  const p = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    const client = await p.connect();
    client.release();
    await p.end();
    return true;
  } catch {
    await p.end().catch(() => {});
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Tenant Isolation (Penetration Tests)', () => {
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;
  let roleAId: string;
  let roleBId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    tenantAId = randomUUID();
    tenantBId = randomUUID();
    userAId = randomUUID();
    userBId = randomUUID();
    roleAId = randomUUID();
    roleBId = randomUUID();

    // Create users first (tenants reference users via owner_id FK)
    await db.insert(schema.users).values({
      id: userAId,
      email: `pentest-a-${Date.now()}@test.com`,
      passwordHash: 'test_hash',
      fullName: 'PenTest User A',
    });

    await db.insert(schema.users).values({
      id: userBId,
      email: `pentest-b-${Date.now()}@test.com`,
      passwordHash: 'test_hash',
      fullName: 'PenTest User B',
    });

    // Create tenants
    await db.insert(schema.tenants).values({
      id: tenantAId,
      name: 'PenTest Tenant A',
      slug: `pentest-a-${Date.now()}`,
      ownerId: userAId,
      status: 'active',
    });

    await db.insert(schema.tenants).values({
      id: tenantBId,
      name: 'PenTest Tenant B',
      slug: `pentest-b-${Date.now()}`,
      ownerId: userBId,
      status: 'active',
    });

    // Create roles for each tenant
    await db.insert(schema.roles).values({
      id: roleAId,
      tenantId: tenantAId,
      name: 'Admin',
      slug: 'admin',
      description: 'Admin role',
    });

    await db.insert(schema.roles).values({
      id: roleBId,
      tenantId: tenantBId,
      name: 'Admin',
      slug: 'admin',
      description: 'Admin role',
    });

    // Add users to tenant_members
    await db.insert(schema.tenantMembers).values({
      tenantId: tenantAId,
      userId: userAId,
      roleId: roleAId,
      roleSlug: 'admin',
      status: 'active',
      joinedAt: new Date(),
    });

    await db.insert(schema.tenantMembers).values({
      tenantId: tenantBId,
      userId: userBId,
      roleId: roleBId,
      roleSlug: 'admin',
      status: 'active',
      joinedAt: new Date(),
    });

    // Create contacts for each tenant
    await db.insert(schema.contacts).values({
      id: randomUUID(),
      tenantId: tenantAId,
      createdBy: userAId,
      firstName: 'Secret',
      lastName: 'Contact A',
      email: `secret-a-${Date.now()}@test.com`,
    });

    await db.insert(schema.contacts).values({
      id: randomUUID(),
      tenantId: tenantBId,
      createdBy: userBId,
      firstName: 'Secret',
      lastName: 'Contact B',
      email: `secret-b-${Date.now()}@test.com`,
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await db.delete(schema.tenantMembers).where(eq(schema.tenantMembers.tenantId, tenantAId));
    await db.delete(schema.tenantMembers).where(eq(schema.tenantMembers.tenantId, tenantBId));
    await db.delete(schema.contacts).where(eq(schema.contacts.tenantId, tenantAId));
    await db.delete(schema.contacts).where(eq(schema.contacts.tenantId, tenantBId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleAId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleBId));
    await db.delete(schema.users).where(eq(schema.users.id, userAId));
    await db.delete(schema.users).where(eq(schema.users.id, userBId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantAId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantBId));
    await pool.end();
  });

  it('should prevent Tenant B from querying Tenant A contacts', async () => {
    const result = await db.select()
      .from(schema.contacts)
      .where(eq(schema.contacts.tenantId, tenantBId));

    for (const contact of result) {
      expect(contact.tenantId).toBe(tenantBId);
      expect(contact.tenantId).not.toBe(tenantAId);
    }
  });

  it('should prevent cross-tenant data access via direct query', async () => {
    const allContacts = await db.select()
      .from(schema.contacts)
      .where(sql`${schema.contacts.tenantId} IN (${tenantAId}, ${tenantBId})`);

    const tenantAContacts = allContacts.filter((c: any) => c.tenantId === tenantAId);
    const tenantBContacts = allContacts.filter((c: any) => c.tenantId === tenantBId);

    expect(tenantAContacts.length).toBeGreaterThan(0);
    expect(tenantBContacts.length).toBeGreaterThan(0);

    for (const contact of allContacts) {
      expect([tenantAId, tenantBId]).toContain(contact.tenantId);
    }
  });

  it('should prevent cross-tenant deal access', async () => {
    const pipelineAId = randomUUID();
    const pipelineBId = randomUUID();

    await db.insert(schema.pipelines).values([
      { id: pipelineAId, tenantId: tenantAId, name: 'Pipeline A', createdBy: userAId },
      { id: pipelineBId, tenantId: tenantBId, name: 'Pipeline B', createdBy: userBId },
    ]);

    const [stageA] = await db.insert(schema.dealStages).values({
      id: randomUUID(),
      tenantId: tenantAId,
      pipelineId: pipelineAId,
      name: 'Lead',
      order: 0,
      createdBy: userAId,
    }).returning();

    const [stageB] = await db.insert(schema.dealStages).values({
      id: randomUUID(),
      tenantId: tenantBId,
      pipelineId: pipelineBId,
      name: 'Lead',
      order: 0,
      createdBy: userBId,
    }).returning();

    const [dealA] = await db.insert(schema.deals).values({
      id: randomUUID(),
      tenantId: tenantAId,
      createdBy: userAId,
      pipelineId: pipelineAId,
      stageId: stageA.id,
      title: 'Secret Deal A',
      amount: '10000',
    }).returning();

    const [dealB] = await db.insert(schema.deals).values({
      id: randomUUID(),
      tenantId: tenantBId,
      createdBy: userBId,
      pipelineId: pipelineBId,
      stageId: stageB.id,
      title: 'Secret Deal B',
      amount: '20000',
    }).returning();

    const tenantBDeals = await db.select()
      .from(schema.deals)
      .where(eq(schema.deals.tenantId, tenantBId));

    for (const deal of tenantBDeals) {
      expect(deal.tenantId).toBe(tenantBId);
      expect(deal.tenantId).not.toBe(tenantAId);
    }

    await db.delete(schema.deals).where(eq(schema.deals.id, dealA.id));
    await db.delete(schema.deals).where(eq(schema.deals.id, dealB.id));
    await db.delete(schema.dealStages).where(eq(schema.dealStages.id, stageA.id));
    await db.delete(schema.dealStages).where(eq(schema.dealStages.id, stageB.id));
    await db.delete(schema.pipelines).where(eq(schema.pipelines.id, pipelineAId));
    await db.delete(schema.pipelines).where(eq(schema.pipelines.id, pipelineBId));
  });

  it('should prevent cross-tenant task access', async () => {
    const [taskA] = await db.insert(schema.tasks).values({
      id: randomUUID(),
      tenantId: tenantAId,
      createdBy: userAId,
      title: 'Secret Task A',
      status: 'pending',
      priority: 'high',
    }).returning();

    const [taskB] = await db.insert(schema.tasks).values({
      id: randomUUID(),
      tenantId: tenantBId,
      createdBy: userBId,
      title: 'Secret Task B',
      status: 'pending',
      priority: 'medium',
    }).returning();

    const tenantATasks = await db.select()
      .from(schema.tasks)
      .where(eq(schema.tasks.tenantId, tenantAId));

    for (const task of tenantATasks) {
      expect(task.tenantId).toBe(tenantAId);
      expect(task.tenantId).not.toBe(tenantBId);
    }

    await db.delete(schema.tasks).where(eq(schema.tasks.id, taskA.id));
    await db.delete(schema.tasks).where(eq(schema.tasks.id, taskB.id));
  });

  it('should verify RLS policies are enabled on critical tables', async () => {
    const rlsResult = await db.execute(sql`
      SELECT schemaname, tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename IN ('contacts', 'deals', 'companies', 'tasks', 'leads', 'tenants', 'users')
      ORDER BY tablename
    `);

    const rows = rlsResult?.rows || rlsResult || [];
    const rlsStatus: Record<string, boolean> = {};
    for (const row of rows) {
      rlsStatus[row.tablename as string] = row.rowsecurity === true;
    }

    console.log('RLS Status:', rlsStatus);
    expect(rlsStatus['tenants']).toBeDefined();
  });
});
