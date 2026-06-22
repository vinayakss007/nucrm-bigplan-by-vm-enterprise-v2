import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '@/drizzle/db';
import { users, tenants, tenantMembers, roles, sessions, pipelines, dealStages } from '@/drizzle/schema';
import { eq, count } from 'drizzle-orm';
import { hashPassword, createToken, hashToken } from '@/lib/auth/session';

async function main() {
  console.log('[seed-fresh] Starting...');

  // Check if data already exists
  const [existingUsers] = await db.select({ count: count() }).from(users);
  if (existingUsers.count > 0) {
    console.log(`[seed-fresh] ${existingUsers.count} users already exist. Cleaning...`);
    // Clean all data
    await db.delete(sessions);
    await db.delete(tenantMembers);
    await db.delete(dealStages);
    await db.delete(pipelines);
    await db.delete(roles);
    await db.delete(users);
    await db.delete(tenants);
  }

  // Create admin
  const passwordHash = await hashPassword('Admin123!');
  const [admin] = await db.insert(users).values({
    email: 'admin@nucrm.com',
    passwordHash,
    fullName: 'Super Admin',
    isSuperAdmin: true,
  }).returning();
  console.log(`[seed-fresh] Created admin: ${admin.id}`);

  // Create tenant
  const [tenant] = await db.insert(tenants).values({
    name: 'NuCRM Demo',
    slug: 'nucrm-demo-' + Date.now().toString(36),
    ownerId: admin.id,
    planId: 'enterprise',
    status: 'active',
  }).returning();
  console.log(`[seed-fresh] Created tenant: ${tenant.id}`);

  // Create admin role
  const [adminRole] = await db.insert(roles).values({
    tenantId: tenant.id,
    slug: 'admin',
    name: 'Administrator',
    permissions: { all: true },
    isSystem: true,
  }).returning();

  // Create sales_rep role
  await db.insert(roles).values({
    tenantId: tenant.id,
    slug: 'sales_rep',
    name: 'Sales Representative',
    permissions: { 'contacts.view': true, 'contacts.create': true, 'contacts.edit': true, 'deals.view': true, 'deals.create': true, 'deals.edit': true },
  });

  // Add admin to tenant
  await db.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId: admin.id,
    roleSlug: 'admin',
    roleId: adminRole.id,
    status: 'active',
    joinedAt: new Date(),
  });

  // Update user's last tenant
  await db.update(users).set({ lastTenantId: tenant.id }).where(eq(users.id, admin.id));

  // Create default pipeline
  const [pipeline] = await db.insert(pipelines).values({
    tenantId: tenant.id,
    name: 'Sales Pipeline',
    isDefault: true,
  }).returning();

  const stages = [
    { name: 'Lead', order: 1 },
    { name: 'Qualified', order: 2 },
    { name: 'Proposal', order: 3 },
    { name: 'Negotiation', order: 4 },
    { name: 'Closed Won', order: 5 },
    { name: 'Closed Lost', order: 6 },
  ];
  for (const s of stages) {
    await db.insert(dealStages).values({
      pipelineId: pipeline.id,
      name: s.name,
      order: s.order,
    });
  }
  console.log(`[seed-fresh] Created pipeline with ${stages.length} stages`);

  // Create a session token
  const token = await createToken(admin.id);
  const tokenHash = await hashToken(token);
  await db.insert(sessions).values({
    userId: admin.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  console.log('[seed-fresh] Done!');
  console.log(`  Email: admin@nucrm.com`);
  console.log(`  Password: Admin123!`);
  console.log(`  Tenant: ${tenant.name} (${tenant.id})`);
}

main().catch((err) => {
  console.error('[seed-fresh] Failed:', err);
  process.exit(1);
});
