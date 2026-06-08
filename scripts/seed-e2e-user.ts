#!/usr/bin/env tsx
import { db } from '../drizzle/db';
import { users, tenants, tenantMembers, roles, sessions, pipelines, dealStages, contacts, deals } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { hashPassword, createToken, hashToken } from '../lib/auth/session';
import * as crypto from 'crypto';

async function main() {
  const email = 'superadmin@nucrm.com';

  if (process.argv.includes('--check')) {
    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      console.log('E2E user exists. Use --force to re-seed.');
      process.exit(0);
    } else {
      console.log('E2E user not found. Run without --check to create.');
      process.exit(1);
    }
  }

  // Allow re-seeding with --force
  if (process.argv.includes('--force')) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      console.log('Force re-seeding: deleting existing E2E user data...');
      const existingTenant = await db.select({ id: tenantMembers.tenantId }).from(tenantMembers).where(eq(tenantMembers.userId, existing[0].id)).limit(1);
      if (existingTenant.length > 0) {
        // Delete in dependency order
        await db.delete(deals).where(eq(deals.tenantId, existingTenant[0].id));
        await db.delete(dealStages).where(eq(dealStages.tenantId, existingTenant[0].id));
        await db.delete(pipelines).where(eq(pipelines.tenantId, existingTenant[0].id));
        await db.delete(contacts).where(eq(contacts.tenantId, existingTenant[0].id));
        await db.delete(tenantMembers).where(eq(tenantMembers.tenantId, existingTenant[0].id));
        await db.delete(tenants).where(eq(tenants.id, existingTenant[0].id));
      }
      await db.delete(sessions).where(eq(sessions.userId, existing[0].id));
      await db.delete(users).where(eq(users.id, existing[0].id));
      console.log('Old data deleted.');
    }
  } else {
    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      console.log('E2E user already exists. Use --force to re-seed.');
      return;
    }
  }

  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword('admin123');

  // ── 1. User + Tenant + Membership ─────────────────────────────
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

  const [role] = await db.select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, 'admin')))
    .limit(1);

  if (!role) {
    console.error('Admin role not auto-created by trigger. Check DB functions.');
    process.exit(1);
  }

  await db.insert(tenantMembers).values({
    tenantId,
    userId,
    roleId: role.id,
    roleSlug: 'admin',
    status: 'active',
    joinedAt: now,
  });

  const token = await createToken(userId);
  const tokenHash = await hashToken(token);
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  // ── 2. Pipeline + 6 Stages ────────────────────────────────────
  const pipelineId = crypto.randomUUID();
  await db.insert(pipelines).values({
    id: pipelineId,
    tenantId,
    name: 'Default Sales Pipeline',
    description: 'Standard B2B sales pipeline',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });

  const stageDefs = [
    { name: 'New Lead', order: 0 },
    { name: 'Qualified', order: 1 },
    { name: 'Meeting Scheduled', order: 2 },
    { name: 'Proposal Sent', order: 3 },
    { name: 'Negotiation', order: 4 },
    { name: 'Closed Won', order: 5 },
  ];
  const stageIds = [];
  for (const sd of stageDefs) {
    const sid = crypto.randomUUID();
    stageIds.push(sid);
    await db.insert(dealStages).values({
      id: sid,
      pipelineId,
      tenantId,
      name: sd.name,
      order: sd.order,
      createdAt: now,
      updatedAt: now,
    });
  }

  // ── 3. Contacts (8) ───────────────────────────────────────────
  const contactData = [
    { first: 'Alice', last: 'Johnson', email: 'alice@example.com', phone: '+1-555-0101', job: 'CEO', company: 'Acme Corp' },
    { first: 'Bob', last: 'Smith', email: 'bob@example.com', phone: '+1-555-0102', job: 'CTO', company: 'TechCo' },
    { first: 'Carol', last: 'Davis', email: 'carol@example.com', phone: '+1-555-0103', job: 'VP Sales', company: 'Globex' },
    { first: 'Dan', last: 'Wilson', email: 'dan@example.com', phone: '+1-555-0104', job: 'Marketing Director', company: 'Initech' },
    { first: 'Eve', last: 'Martin', email: 'eve@example.com', phone: '+1-555-0105', job: 'Product Manager', company: 'Umbrella' },
    { first: 'Frank', last: 'Lee', email: 'frank@example.com', phone: '+1-555-0106', job: 'Engineer', company: 'Stark Ind' },
    { first: 'Grace', last: 'Kim', email: 'grace@example.com', phone: '+1-555-0107', job: 'Designer', company: 'Pied Piper' },
    { first: 'Henry', last: 'Brown', email: 'henry@example.com', phone: '+1-555-0108', job: 'Founder', company: 'Dunder Mifflin' },
  ];
  const contactIds = [];
  for (const cd of contactData) {
    const cid = crypto.randomUUID();
    contactIds.push(cid);
    await db.insert(contacts).values({
      id: cid,
      tenantId,
      firstName: cd.first,
      lastName: cd.last,
      email: cd.email,
      phone: cd.phone,
      jobTitle: cd.job,
      leadStatus: 'new',
      assignedTo: userId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // ── 4. Deals (5, spread across stages) ────────────────────────
  const dealData = [
    { title: 'Acme Corp — Q3 Platform', amount: '50000', stageIdx: 0, contactIdx: 0 },
    { title: 'TechCo — Enterprise License', amount: '120000', stageIdx: 1, contactIdx: 1 },
    { title: 'Globex — Annual Renewal', amount: '75000', stageIdx: 2, contactIdx: 2 },
    { title: 'Initech — Consulting Package', amount: '25000', stageIdx: 3, contactIdx: 3 },
    { title: 'Umbrella — SaaS Subscription', amount: '90000', stageIdx: 4, contactIdx: 4 },
  ];
  for (const dd of dealData) {
    await db.insert(deals).values({
      id: crypto.randomUUID(),
      tenantId,
      contactId: contactIds[dd.contactIdx],
      pipelineId,
      stageId: stageIds[dd.stageIdx],
      title: dd.title,
      amount: dd.amount,
      assignedTo: userId,
      createdAt: now,
      updatedAt: now,
    });
  }

  console.log('E2E test user + seed data created!');
  console.log('  Email:    ' + email);
  console.log('  Password: admin123');
  console.log('  Pipeline: Default Sales Pipeline (6 stages)');
  console.log('  Contacts: 8');
  console.log('  Deals:    5');
}

main().catch(console.error);
