#!/usr/bin/env tsx
import { db } from '../drizzle/db';
import { users, tenants, tenantMembers, roles, sessions, contacts, pipelines, dealStages, deals } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { hashPassword, createToken, hashToken } from '../lib/auth/session';
import * as crypto from 'crypto';

async function main() {
  const email = 'superadmin@nucrm.com';

  const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let userId: string;
  let tenantId: string;

  if (existingUser.length > 0) {
    console.log('E2E user already exists. Checking seed data...');
    const user = await db.select({ id: users.id, lastTenantId: users.lastTenantId }).from(users).where(eq(users.email, email)).limit(1);
    userId = user[0].id;
    tenantId = user[0].lastTenantId!;
  } else {
    userId = crypto.randomUUID();
    tenantId = crypto.randomUUID();
    const passwordHash = await hashPassword('admin123');

    await db.insert(users).values({
      id: userId,
      email,
      passwordHash,
      fullName: 'Test Admin',
      isSuperAdmin: false,
      lastTenantId: tenantId,
    });

    await db.insert(tenants).values({
      id: tenantId,
      name: 'E2E Test Workspace',
      slug: 'e2e-test-' + Date.now().toString(36),
      ownerId: userId,
      status: 'active',
    });

    // Create default roles for this tenant (trigger may not exist)
    const adminRoleId = crypto.randomUUID();
    const memberRoleId = crypto.randomUUID();
    await db.insert(roles).values([
      { id: adminRoleId, tenantId, name: 'Admin', slug: 'admin', description: 'Administrator' },
      { id: memberRoleId, tenantId, name: 'Member', slug: 'member', description: 'Regular member' },
    ]);

    const role = await db.select().from(roles).where(eq(roles.id, adminRoleId)).limit(1);

    await db.insert(tenantMembers).values({
      tenantId,
      userId,
      roleId: role.id,
      roleSlug: 'admin',
      status: 'active',
      joinedAt: new Date(),
    });

    const token = await createToken(userId);
    const tokenHash = await hashToken(token);
    await db.insert(sessions).values({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    console.log('E2E test user created!');
    console.log('  Email:    ' + email);
    console.log('  Password: admin123');
  }

  // ── Seed contacts ──
  const existingContacts = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.tenantId, tenantId)).limit(1);
  if (existingContacts.length === 0) {
    const names = [
      { first: 'Alice', last: 'Johnson', email: 'alice@example.com' },
      { first: 'Bob', last: 'Smith', email: 'bob@example.com' },
      { first: 'Carol', last: 'Williams', email: 'carol@example.com' },
      { first: 'David', last: 'Brown', email: 'david@example.com' },
      { first: 'Eve', last: 'Davis', email: 'eve@example.com' },
      { first: 'Frank', last: 'Miller', email: 'frank@example.com' },
      { first: 'Grace', last: 'Wilson', email: 'grace@example.com' },
      { first: 'Henry', last: 'Moore', email: 'henry@example.com' },
    ];
    for (const n of names) {
      await db.insert(contacts).values({
        id: crypto.randomUUID(),
        tenantId,
        createdBy: userId,
        firstName: n.first,
        lastName: n.last,
        email: n.email,
      });
    }
    console.log(`Seeded ${names.length} contacts.`);
  } else {
    console.log('Contacts already exist. Skipping.');
  }

  // ── Seed pipeline + stages + deals ──
  const existingPipeline = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.tenantId, tenantId)).limit(1);
  let pipelineId: string;
  let stageIds: string[] = [];

  if (existingPipeline.length === 0) {
    pipelineId = crypto.randomUUID();
    await db.insert(pipelines).values({
      id: pipelineId,
      tenantId,
      name: 'Default Sales Pipeline',
      createdBy: userId,
    });
    console.log('Seeded pipeline.');

    const stageNames = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    for (let i = 0; i < stageNames.length; i++) {
      const stageId = crypto.randomUUID();
      stageIds.push(stageId);
      await db.insert(dealStages).values({
        id: stageId,
        tenantId,
        pipelineId,
        name: stageNames[i],
        order: i,
        createdBy: userId,
      });
    }
    console.log(`Seeded ${stageNames.length} stages.`);

    // ── Seed deals ──
    const dealData = [
      { title: 'Enterprise Deal - ABC Corp', amount: '50000', stageIdx: 0 },
      { title: 'Mid-Market Deal - XYZ Inc', amount: '15000', stageIdx: 1 },
      { title: 'SMB Deal - Small Biz Co', amount: '5000', stageIdx: 2 },
      { title: 'Follow-up Deal - Old Client', amount: '25000', stageIdx: 3 },
    ];
    for (const d of dealData) {
      await db.insert(deals).values({
        id: crypto.randomUUID(),
        tenantId,
        pipelineId,
        stageId: stageIds[d.stageIdx],
        title: d.title,
        amount: d.amount,
        createdBy: userId,
      });
    }
    console.log(`Seeded ${dealData.length} deals.`);
  } else {
    pipelineId = existingPipeline[0].id;
    console.log('Pipeline already exists. Skipping.');
  }

  console.log('\nE2E seed complete.');
}

main().catch(console.error);
