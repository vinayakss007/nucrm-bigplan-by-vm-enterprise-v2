#!/usr/bin/env tsx
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { db } from '../drizzle/db';
import * as schema from '../drizzle/schema';
import { eq, and, like, inArray, sql } from 'drizzle-orm';
import crypto from 'crypto';

const BATCH = parseInt(process.env['STRESS_BATCH'] || '100', 10);
const DRY_RUN = process.argv.includes('--dry-run');
const STRESS_TAG = '__stress_test__';

interface StressResult {
  table: string;
  inserted: number;
  errors: string[];
  durationMs: number;
}

const results: StressResult[] = [];
const startTime = Date.now();

async function getExistingRefs() {
  const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).limit(1);
  if (!tenant) throw new Error('No tenant found. Run npm run seed:dev first.');
  const tid = tenant.id;

  const [user] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (!user) throw new Error('No user found. Run npm run seed:dev first.');
  const uid = user.id;

  const pipelines = await db.select({ id: schema.pipelines.id }).from(schema.pipelines).where(eq(schema.pipelines.tenantId, tid));
  if (pipelines.length === 0) throw new Error('No pipelines found. Run npm run seed:dev first.');
  const pipelineId = pipelines[0]!.id;

  const stages = await db.select({ id: schema.dealStages.id }).from(schema.dealStages).where(eq(schema.dealStages.pipelineId, pipelineId));
  if (stages.length === 0) throw new Error('No deal stages found. Run npm run seed:dev first.');
  const stageId = stages[0]!.id;

  const [company] = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.tenantId, tid)).limit(1);
  const companyId = company?.id;

  return { tenantId: tid, userId: uid, pipelineId, stageId, companyId };
}

async function cleanup(tid: string) {
  const tables = [
    { name: 'activities', table: schema.activities },
    { name: 'tasks', table: schema.tasks },
    { name: 'notes', table: schema.notes },
    { name: 'deals', table: schema.deals },
    { name: 'leads', table: schema.leads },
    { name: 'contacts', table: schema.contacts },
    { name: 'companies', table: schema.companies },
    { name: 'tickets', table: schema.tickets },
    { name: 'sequences', table: schema.sequences },
    { name: 'workflows', table: schema.workflows },
    { name: 'products', table: schema.products },
    { name: 'contracts', table: schema.contracts },
    { name: 'orders', table: schema.orders },
    { name: 'quotes', table: schema.quotes },
    { name: 'tenants', table: schema.tenants },
  ];

  for (const t of tables) {
    try {
      const col = 'tenantId' in t.table ? t.table.tenantId : undefined;
      if (col) {
        const deleted = await db.delete(t.table)
          .where(and(eq(col as any, tid), sql`metadata->>'stress' = ${STRESS_TAG}`));
        console.log(`  cleaned ${t.name}`);
      }
    } catch {}
  }
}

async function insertRows(tableName: string, table: any, values: () => Record<string, any>, refs: Awaited<ReturnType<typeof getExistingRefs>>) {
  if (DRY_RUN) {
    console.log(`[dry-run] would insert ${BATCH} into ${tableName}`);
    return;
  }
  const t0 = Date.now();
  const errors: string[] = [];
  let inserted = 0;

  for (let i = 0; i < BATCH; i++) {
    try {
      const row = { ...values(), metadata: { stress: STRESS_TAG, batch: i } };
      await db.insert(table).values(row);
      inserted++;
    } catch (err: any) {
      errors.push(`row ${i}: ${err.message?.slice(0, 120)}`);
      console.error(`[stress] ${tableName}[${i}] failed: ${err.message?.slice(0, 120)}`);
      if (errors.length >= 5) break;
    }
  }

  results.push({ table: tableName, inserted, errors, durationMs: Date.now() - t0 });
  console.log(`[stress] ${tableName}: ${inserted}/${BATCH} rows in ${Date.now() - t0}ms${errors.length ? ` (${errors.length} errors)` : ''}`);
}

async function main() {
  console.log('═══ STRESS TEST ═══');
  console.log(`Batch: ${BATCH}, Dry-run: ${DRY_RUN}\n`);

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Create .env.local');
    process.exit(1);
  }

  const refs = await getExistingRefs();
  console.log(`Using tenant: ${refs.tenantId}, user: ${refs.userId}, pipeline: ${refs.pipelineId}, stage: ${refs.stageId}\n`);

  console.log('Cleaning previous stress data...');
  await cleanup(refs.tenantId);
  console.log('Cleanup complete.\n');

  const now = Date.now();
  const genId = () => crypto.randomUUID();
  const rng = () => Math.random().toString(36).slice(2, 8);

  // ── Contacts ──
  await insertRows('contacts', schema.contacts, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    firstName: `Stress${now}`,
    lastName: `Contact${rng()}`,
    email: `stress.${now}.${rng()}@test.com`,
    phone: `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`,
    leadStatus: 'new',
    assignedTo: refs.userId,
  }), refs);

  // Fetch inserted contacts for FK refs
  const insertedContacts = await db.select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.tenantId, refs.tenantId), sql`metadata->>'stress' = ${STRESS_TAG}`))
    .limit(BATCH);
  const contactIds = insertedContacts.map(c => c.id);

  // ── Companies ──
  await insertRows('companies', schema.companies, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    name: `Stress Company ${rng()}`,
    industry: 'Technology',
    website: `https://stress-${rng()}.com`,
  }), refs);

  const insertedCompanies = await db.select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(eq(schema.companies.tenantId, refs.tenantId), sql`metadata->>'stress' = ${STRESS_TAG}`))
    .limit(BATCH);
  const companyIds = insertedCompanies.map(c => c.id);

  // ── Deals ──
  await insertRows('deals', schema.deals, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    title: `Stress Deal ${now}`,
    amount: String(Math.floor(Math.random() * 100000)),
    pipelineId: refs.pipelineId,
    stageId: refs.stageId,
    assignedTo: refs.userId,
    contactId: contactIds[Math.floor(Math.random() * contactIds.length)] || null,
    companyId: companyIds[Math.floor(Math.random() * companyIds.length)] || null,
  }), refs);

  // ── Leads ──
  await insertRows('leads', schema.leads, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    firstName: `Stress${now}`,
    lastName: `Lead${rng()}`,
    email: `stress.lead.${now}.${rng()}@test.com`,
    leadStatus: 'new',
    source: 'stress_test',
    assignedTo: refs.userId,
  }), refs);

  // ── Tasks ──
  await insertRows('tasks', schema.tasks, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    title: `Stress Task ${now}`,
    status: 'pending',
    priority: 'medium',
    assignedTo: refs.userId,
  }), refs);

  // ── Notes ──
  await insertRows('notes', schema.notes, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    entityType: 'contact',
    entityId: contactIds[Math.floor(Math.random() * contactIds.length)] || genId(),
    content: `Stress test note ${now}`,
    createdBy: refs.userId,
  }), refs);

  // ── Activities ──
  await insertRows('activities', schema.activities, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    userId: refs.userId,
    entityType: 'contact',
    entityId: contactIds[Math.floor(Math.random() * contactIds.length)] || genId(),
    eventType: 'stress_test',
    action: 'create',
    description: `Stress activity ${now}`,
  }), refs);

  // ── Products ──
  await insertRows('products', schema.products, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    name: `Stress Product ${rng()}`,
    basePrice: String(Math.floor(Math.random() * 1000)),
  }), refs);

  // ── Contracts ──
  await insertRows('contracts', schema.contracts, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    title: `Stress Contract ${now}`,
    contractType: 'service',
    status: 'draft',
    startDate: new Date().toISOString().split('T')[0]!,
    createdBy: refs.userId,
  }), refs);

  // ── Orders ──
  await insertRows('orders', schema.orders, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    orderNumber: `STRESS-${now}-${rng()}`,
    status: 'draft',
    orderDate: new Date().toISOString().split('T')[0]!,
    subtotal: '0',
    totalAmount: '0',
    createdBy: refs.userId,
  }), refs);

  // ── Quotes ──
  await insertRows('quotes', schema.quotes, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    title: `Stress Quote ${now}`,
    status: 'draft',
    totalAmount: '0',
    createdBy: refs.userId,
  }), refs);

  // ── Tickets ──
  await insertRows('tickets', schema.tickets, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    subject: `Stress Ticket ${now}`,
    status: 'open',
    priority: 'medium',
    createdBy: refs.userId,
  }), refs);

  // ── Sequences ──
  await insertRows('sequences', schema.sequences, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    name: `Stress Sequence ${now}`,
    status: 'active',
    createdBy: refs.userId,
  }), refs);

  // ── Workflows ──
  await insertRows('workflows', schema.workflows, () => ({
    id: genId(),
    tenantId: refs.tenantId,
    name: `Stress Workflow ${now}`,
    triggerType: 'manual',
    triggerConfig: {},
    nodes: [],
    createdBy: refs.userId,
  }), refs);

  // ── Summary ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  console.log('\n══════════════════════════════════════════════');
  console.log('  STRESS TEST RESULTS');
  console.log(`  Duration: ${elapsed}s`);
  console.log(`  Tables:   ${results.length}`);
  console.log(`  Rows:     ${totalInserted}`);
  console.log(`  Errors:   ${totalErrors}`);
  console.log('──────────────────────────────────────────────');

  for (const r of results) {
    const ok = r.errors.length === 0 ? '✓' : '✗';
    console.log(`  ${ok} ${r.table.padEnd(20)} ${String(r.inserted).padStart(4)}/${BATCH} rows  ${r.durationMs}ms`);
    for (const e of r.errors) {
      console.log(`       ${e}`);
    }
  }

  console.log('══════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('[stress] fatal error:', err);
  process.exit(1);
});
