import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/drizzle/db';
import { companies, contacts, leads, deals, dealStages, pipelines } from '@/drizzle/schema/crm';
import { users, tenants } from '@/drizzle/schema/core';
import { eq, count } from 'drizzle-orm';

async function main() {
  // Get existing admin and tenant
  const [admin] = await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  if (!admin) { console.error('No super admin found. Run seed-fresh first.'); process.exit(1); }
  const [tenant] = await db.select().from(tenants).where(eq(tenants.ownerId, admin.id)).limit(1);
  if (!tenant) { console.error('No tenant found.'); process.exit(1); }

  const tenantId = tenant.id;
  const userId = admin.id;

  console.log(`Using admin: ${admin.email}, tenant: ${tenant.name}`);

  // Get pipeline & stages
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.tenantId, tenantId)).limit(1);
  if (!pipeline) { console.error('No pipeline found.'); process.exit(1); }
  const stages = await db.select().from(dealStages).where(eq(dealStages.pipelineId, pipeline.id)).orderBy(dealStages.order);

  console.log(`Pipeline: ${pipeline.name} with ${stages.length} stages`);

  // Companies
  const companyData = [
    { name: 'Acme Corp', industry: 'Technology', website: 'https://acme.com', phone: '+1-555-0100' },
    { name: 'Globex Inc', industry: 'Manufacturing', website: 'https://globex.com', phone: '+1-555-0200' },
    { name: 'Initech', industry: 'Software', website: 'https://initech.com', phone: '+1-555-0300' },
    { name: 'Umbrella Corp', industry: 'Pharmaceuticals', website: 'https://umbrella.com', phone: '+1-555-0400' },
    { name: 'Stark Industries', industry: 'Defense', website: 'https://stark.com', phone: '+1-555-0500' },
  ];
  const companyIds: string[] = [];
  for (const c of companyData) {
    const [existing] = await db.select().from(companies).where(eq(companies.name, c.name)).limit(1);
    if (existing) { companyIds.push(existing.id); continue; }
    const [ins] = await db.insert(companies).values({ ...c, tenantId, createdBy: userId }).returning();
    companyIds.push(ins.id);
    console.log(`  Company: ${c.name} (${ins.id})`);
  }

  // Contacts
  const contactData = [
    { firstName: 'John', lastName: 'Doe', email: 'john@acme.com', phone: '+1-555-1001', jobTitle: 'CEO', lifecycleStage: 'customer', companyId: companyIds[0] },
    { firstName: 'Jane', lastName: 'Smith', email: 'jane@globex.com', phone: '+1-555-1002', jobTitle: 'VP Sales', lifecycleStage: 'customer', companyId: companyIds[1] },
    { firstName: 'Bob', lastName: 'Johnson', email: 'bob@initech.com', phone: '+1-555-1003', jobTitle: 'CTO', lifecycleStage: 'lead', companyId: companyIds[2] },
    { firstName: 'Alice', lastName: 'Brown', email: 'alice@umbrella.com', phone: '+1-555-1004', jobTitle: 'Director', lifecycleStage: 'subscriber', companyId: companyIds[3] },
    { firstName: 'Tony', lastName: 'Stark', email: 'tony@stark.com', phone: '+1-555-1005', jobTitle: 'CEO', lifecycleStage: 'customer', companyId: companyIds[4] },
    { firstName: 'Steve', lastName: 'Rogers', email: 'steve@acme.com', phone: '+1-555-1006', jobTitle: 'Operations', lifecycleStage: 'lead', companyId: companyIds[0] },
    { firstName: 'Natasha', lastName: 'Romanoff', email: 'natasha@globex.com', phone: '+1-555-1007', jobTitle: 'Security', lifecycleStage: 'lead', companyId: companyIds[1] },
    { firstName: 'Bruce', lastName: 'Banner', email: 'bruce@initech.com', phone: '+1-555-1008', jobTitle: 'R&D', lifecycleStage: 'subscriber', companyId: companyIds[2] },
    { firstName: 'Clark', lastName: 'Kent', email: 'clark@dailyplanet.com', phone: '+1-555-1009', jobTitle: 'Reporter', lifecycleStage: 'lead' },
    { firstName: 'Diana', lastName: 'Prince', email: 'diana@themyscira.com', phone: '+1-555-1010', jobTitle: 'Ambassador', lifecycleStage: 'customer' },
  ];
  const contactIds: string[] = [];
  for (const c of contactData) {
    const [existing] = await db.select().from(contacts).where(eq(contacts.email, c.email)).limit(1);
    if (existing) { contactIds.push(existing.id); continue; }
    const [ins] = await db.insert(contacts).values({ ...c, tenantId, assignedTo: userId, createdBy: userId }).returning();
    contactIds.push(ins.id);
    console.log(`  Contact: ${c.firstName} ${c.lastName} (${ins.id})`);
  }

  // Leads
  const leadData = [
    { firstName: 'Peter', lastName: 'Parker', email: 'peter@dailybugle.com', companyName: 'Daily Bugle', status: 'new' },
    { firstName: 'Wade', lastName: 'Wilson', email: 'wade@mercs.com', companyName: 'Mercs Inc', status: 'contacted' },
    { firstName: 'Logan', lastName: 'Howlett', email: 'logan@xavier.com', companyName: 'Xavier Institute', status: 'qualified' },
    { firstName: 'Ororo', lastName: 'Munroe', email: 'ororo@xavier.com', companyName: 'Xavier Institute', status: 'new' },
    { firstName: 'Reed', lastName: 'Richards', email: 'reed@baxter.com', companyName: 'Baxter Foundation', status: 'qualified' },
  ];
  for (const l of leadData) {
    const [existing] = await db.select().from(leads).where(eq(leads.email, l.email)).limit(1);
    if (existing) continue;
    await db.insert(leads).values({ ...l, tenantId, assignedTo: userId, createdBy: userId }).returning();
    console.log(`  Lead: ${l.firstName} ${l.lastName} (${l.companyName})`);
  }

  // Deals
  const dealData = [
    { title: 'Enterprise License - Acme', amount: 120000, stageIdx: 0, contactIdx: 0, companyIdx: 0 },
    { title: 'Security Suite - Globex', amount: 75000, stageIdx: 1, contactIdx: 1, companyIdx: 1 },
    { title: 'Cloud Migration - Initech', amount: 200000, stageIdx: 2, contactIdx: 2, companyIdx: 2 },
    { title: 'Pharma CRM - Umbrella', amount: 95000, stageIdx: 0, contactIdx: 3, companyIdx: 3 },
    { title: 'Defense Contract - Stark', amount: 500000, stageIdx: 3, contactIdx: 4, companyIdx: 4 },
    { title: 'Support Package - Acme', amount: 35000, stageIdx: 4, contactIdx: 5, companyIdx: 0 },
    { title: 'Data Analytics - Globex', amount: 88000, stageIdx: 1, contactIdx: 6, companyIdx: 1 },
    { title: 'AI Integration - Initech', amount: 150000, stageIdx: 2, contactIdx: 7, companyIdx: 2 },
  ];
  for (const d of dealData) {
    const [existing] = await db.select().from(deals).where(eq(deals.title, d.title)).limit(1);
    if (existing) continue;
    await db.insert(deals).values({
      title: d.title,
      amount: d.amount,
      stageId: stages[d.stageIdx].id,
      pipelineId: pipeline.id,
      contactId: contactIds[d.contactIdx],
      companyId: companyIds[d.companyIdx],
      tenantId,
      assignedTo: userId,
      createdBy: userId,
    }).returning();
    console.log(`  Deal: ${d.title} (\$${d.amount})`);
  }

  console.log('\n=== SEED COMPLETE ===');
  const [cCount] = await db.select({ count: count() }).from(contacts);
  const [lCount] = await db.select({ count: count() }).from(leads);
  const [dCount] = await db.select({ count: count() }).from(deals);
  const [coCount] = await db.select({ count: count() }).from(companies);
  console.log(`  Companies: ${coCount.count}`);
  console.log(`  Contacts: ${cCount.count}`);
  console.log(`  Leads: ${lCount.count}`);
  console.log(`  Deals: ${dCount.count}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
