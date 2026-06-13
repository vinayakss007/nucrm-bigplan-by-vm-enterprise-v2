#!/usr/bin/env tsx
import { db } from '../drizzle/db';
import { users, tenants, tenantMembers, roles, sessions, pipelines, dealStages, contacts, deals } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { hashPassword, createToken, hashToken } from '../lib/auth/session';
import * as crypto from 'crypto';

const EMAIL = 'superadmin@nucrm.com';
const PASSWORD = 'admin123';
const STANDARD_STAGES = [
  { name: 'Lead', order: 0 },
  { name: 'Qualified', order: 1 },
  { name: 'Proposal', order: 2 },
  { name: 'Negotiation', order: 3 },
  { name: 'Won', order: 4 },
  { name: 'Lost', order: 5 },
];
const CONTACT_DATA = [
  { first: 'Alice', last: 'Johnson', email: 'alice@example.com', phone: '+1-555-0101', job: 'CEO', company: 'Acme Corp' },
  { first: 'Bob', last: 'Smith', email: 'bob@example.com', phone: '+1-555-0102', job: 'CTO', company: 'TechCo' },
  { first: 'Carol', last: 'Davis', email: 'carol@example.com', phone: '+1-555-0103', job: 'VP Sales', company: 'Globex' },
  { first: 'Dan', last: 'Wilson', email: 'dan@example.com', phone: '+1-555-0104', job: 'Marketing Director', company: 'Initech' },
  { first: 'Eve', last: 'Martin', email: 'eve@example.com', phone: '+1-555-0105', job: 'Product Manager', company: 'Umbrella' },
  { first: 'Frank', last: 'Lee', email: 'frank@example.com', phone: '+1-555-0106', job: 'Engineer', company: 'Stark Ind' },
  { first: 'Grace', last: 'Kim', email: 'grace@example.com', phone: '+1-555-0107', job: 'Designer', company: 'Pied Piper' },
  { first: 'Henry', last: 'Brown', email: 'henry@example.com', phone: '+1-555-0108', job: 'Founder', company: 'Dunder Mifflin' },
];
const DEAL_DATA = [
  { title: 'Acme Corp - Q3 Platform', amount: '50000', stageIdx: 0, contactIdx: 0 },
  { title: 'TechCo - Enterprise License', amount: '120000', stageIdx: 1, contactIdx: 1 },
  { title: 'Globex - Annual Renewal', amount: '75000', stageIdx: 2, contactIdx: 2 },
  { title: 'Initech - Consulting Package', amount: '25000', stageIdx: 3, contactIdx: 3 },
  { title: 'Umbrella - SaaS Subscription', amount: '90000', stageIdx: 4, contactIdx: 4 },
];

async function ensureUserAndTenant() {
  const existingUser = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);

  if (existingUser.length > 0) {
    const user = existingUser[0];
    const existingMembership = await db.select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id))
      .limit(1);

    if (existingMembership.length > 0) {
      return { userId: user.id, tenantId: existingMembership[0].tenantId, created: false };
    }
    return { userId: user.id, tenantId: null, created: false };
  }

  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const passwordHash = await hashPassword(PASSWORD);

  await db.insert(users).values({
    id: userId,
    email: EMAIL,
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
    joinedAt: new Date(),
  });

  const token = await createToken(userId);
  const tokenHash = await hashToken(token);
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return { userId, tenantId, created: true };
}

async function ensurePipelineAndStages(tenantId: string) {
  let [pipeline] = await db.select()
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.isDefault, true)))
    .limit(1);

  if (!pipeline) {
    const pipelineId = crypto.randomUUID();
    await db.insert(pipelines).values({
      id: pipelineId,
      tenantId,
      name: 'Default Sales Pipeline',
      description: 'Standard B2B sales pipeline',
      isDefault: true,
    });
    pipeline = { id: pipelineId, tenantId, name: 'Default Sales Pipeline', description: 'Standard B2B sales pipeline', isDefault: true };
  }

  const existingStages = await db.select()
    .from(dealStages)
    .where(eq(dealStages.pipelineId, pipeline.id));

  const existingNames = new Set(existingStages.map(s => s.name));
  const stageIds: Record<string, string> = {};

  for (const s of existingStages) {
    stageIds[s.name] = s.id;
  }

  for (const sd of STANDARD_STAGES) {
    if (!existingNames.has(sd.name)) {
      const sid = crypto.randomUUID();
      stageIds[sd.name] = sid;
      await db.insert(dealStages).values({
        id: sid,
        pipelineId: pipeline.id,
        tenantId,
        name: sd.name,
        order: sd.order,
      });
    } else {
      await db.update(dealStages)
        .set({ order: sd.order })
        .where(and(eq(dealStages.id, stageIds[sd.name]), eq(dealStages.pipelineId, pipeline.id)));
    }
  }

  return { pipelineId: pipeline.id, stageIds };
}

async function ensureContacts(tenantId: string, userId: string) {
  const existingContacts = await db.select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.tenantId, tenantId));

  const existingEmails = new Set(existingContacts.map(c => c.email).filter(Boolean));
  const contactIds: string[] = existingContacts.map(c => c.id);

  for (const cd of CONTACT_DATA) {
    if (!existingEmails.has(cd.email)) {
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
      });
    }
  }

  if (contactIds.length > 0) {
    const result = await db.select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(eq(contacts.tenantId, tenantId));
    const emailToId = Object.fromEntries(result.filter(c => c.email).map(c => [c.email, c.id]));
    const orderedIds = CONTACT_DATA.map(cd => emailToId[cd.email]).filter(Boolean);
    return orderedIds.length > 0 ? orderedIds : result.map(c => c.id);
  }

  return contactIds;
}

async function ensureDeals(tenantId: string, pipelineId: string, stageIds: Record<string, string>, contactIds: string[], userId: string) {
  const existingDeals = await db.select({ id: deals.id, title: deals.title })
    .from(deals)
    .where(eq(deals.tenantId, tenantId));

  const existingTitles = new Set(existingDeals.map(d => d.title));

  for (const dd of DEAL_DATA) {
    if (!existingTitles.has(dd.title)) {
      const contactId = contactIds[dd.contactIdx];
      if (!contactId) continue;
      const stageId = stageIds[STANDARD_STAGES[dd.stageIdx].name];
      if (!stageId) continue;

      await db.insert(deals).values({
        id: crypto.randomUUID(),
        tenantId,
        contactId,
        pipelineId,
        stageId,
        title: dd.title,
        amount: dd.amount,
        assignedTo: userId,
      });
    }
  }
}

async function main() {
  const { userId, tenantId, created } = await ensureUserAndTenant();

  if (!tenantId) {
    console.error('E2E user exists but has no tenant membership. Use --force to re-seed.');
    process.exit(1);
  }

  console.log(`E2E user: ${EMAIL} (${created ? 'created' : 'already exists'})`);

  const { pipelineId, stageIds } = await ensurePipelineAndStages(tenantId);
  console.log(`Pipeline: ${pipelineId} with ${Object.keys(stageIds).length} stages`);

  const contactIds = await ensureContacts(tenantId, userId);
  console.log(`Contacts: ${contactIds.length} total`);

  await ensureDeals(tenantId, pipelineId, stageIds, contactIds, userId);
  const dealCount = (await db.select({ id: deals.id }).from(deals).where(eq(deals.tenantId, tenantId))).length;
  console.log(`Deals: ${dealCount} total`);

  console.log('E2E seed data ready!');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
}

main().catch(console.error);
