// @ts-nocheck
/**
 * NuCRM Development Seed Script
 *
 * Populates a local PostgreSQL database with comprehensive test data
 * for development. This script is idempotent and safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/seed-dev.ts
 *   npm run seed:dev
 *
 * Requirements:
 *   - .env.local with DATABASE_URL set
 *   - PostgreSQL running with migrations applied
 *   - NODE_ENV must NOT be 'production'
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// Production guard
if (process.env.NODE_ENV === 'production') {
  console.error('\x1b[31m[ERROR] Cannot run seed script in production!\x1b[0m');
  process.exit(1);
}

// Safety check: only allow local database connections
const dbUrl = process.env.DATABASE_URL || '';
const isLocalDb = /localhost|127\.0\.0\.1|::1/.test(dbUrl);
if (dbUrl && !isLocalDb) {
  console.error('\x1b[31m[ERROR] DATABASE_URL does not point to localhost!\x1b[0m');
  console.error('This seed script is for local development only.');
  console.error('Set DATABASE_URL to a localhost connection or set SEED_ALLOW_REMOTE=true to override.');
  if (process.env.SEED_ALLOW_REMOTE !== 'true') {
    process.exit(1);
  }
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import * as schema from '../drizzle/schema';

// ============================================================================
// FIXED UUIDs (for deterministic relationships)
// ============================================================================

const IDS = {
  tenant: '10000000-0000-0000-0000-000000000001',
  users: {
    admin: '20000000-0000-0000-0000-000000000001',
    manager: '20000000-0000-0000-0000-000000000002',
    rep1: '20000000-0000-0000-0000-000000000003',
    rep2: '20000000-0000-0000-0000-000000000004',
  },
  roles: {
    superAdmin: '30000000-0000-0000-0000-000000000001',
    admin: '30000000-0000-0000-0000-000000000002',
    salesRep: '30000000-0000-0000-0000-000000000003',
    member: '30000000-0000-0000-0000-000000000004',
  },
  pipelines: {
    sales: '40000000-0000-0000-0000-000000000001',
    enterprise: '40000000-0000-0000-0000-000000000002',
  },
  stages: {
    // Sales pipeline
    lead: '50000000-0000-0000-0000-000000000001',
    qualified: '50000000-0000-0000-0000-000000000002',
    proposal: '50000000-0000-0000-0000-000000000003',
    negotiation: '50000000-0000-0000-0000-000000000004',
    closedWon: '50000000-0000-0000-0000-000000000005',
    closedLost: '50000000-0000-0000-0000-000000000006',
    // Enterprise pipeline
    discovery: '50000000-0000-0000-0000-000000000011',
    evaluation: '50000000-0000-0000-0000-000000000012',
    poc: '50000000-0000-0000-0000-000000000013',
    contract: '50000000-0000-0000-0000-000000000014',
    entWon: '50000000-0000-0000-0000-000000000015',
    entLost: '50000000-0000-0000-0000-000000000016',
  },
  companies: Array.from({ length: 30 }, (_, i) =>
    `60000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  contacts: Array.from({ length: 55 }, (_, i) =>
    `70000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  leads: Array.from({ length: 25 }, (_, i) =>
    `71000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  deals: Array.from({ length: 35 }, (_, i) =>
    `80000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  tasks: Array.from({ length: 18 }, (_, i) =>
    `81000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  tickets: Array.from({ length: 12 }, (_, i) =>
    `82000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  products: Array.from({ length: 6 }, (_, i) =>
    `83000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  quotes: Array.from({ length: 5 }, (_, i) =>
    `84000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  forms: Array.from({ length: 3 }, (_, i) =>
    `85000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  ),
  sequences: {
    onboarding: '86000000-0000-0000-0000-000000000001',
    reengagement: '86000000-0000-0000-0000-000000000002',
  },
  webhooks: {
    wh1: '87000000-0000-0000-0000-000000000001',
    wh2: '87000000-0000-0000-0000-000000000002',
  },
  automations: {
    auto1: '88000000-0000-0000-0000-000000000001',
    auto2: '88000000-0000-0000-0000-000000000002',
  },
  plugins: {
    slack: '89000000-0000-0000-0000-000000000001',
    zapier: '89000000-0000-0000-0000-000000000002',
  },
  apiKey: '8A000000-0000-0000-0000-000000000001',
};

// ============================================================================
// HELPERS
// ============================================================================

const log = (emoji: string, msg: string) => console.log(`${emoji}  ${msg}`);
const logSection = (msg: string) => console.log(`\n\x1b[36m━━━ ${msg} ━━━\x1b[0m`);
const logDone = (table: string, count: number) =>
  console.log(`  \x1b[32m✓\x1b[0m ${table} (${count} rows)`);

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function futureDate(daysAhead: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d;
}

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}


// ============================================================================
// MAIN SEED FUNCTION
// ============================================================================

async function main() {
  console.log('\x1b[35m');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║        NuCRM Development Seed Script            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  if (!process.env.DATABASE_URL) {
    console.error('\x1b[31m[ERROR] DATABASE_URL not set. Create .env.local\x1b[0m');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    // ========================================================================
    // CLEANUP - Delete existing seed data (idempotent)
    // ========================================================================
    logSection('Cleaning existing seed data');

    await db.delete(schema.tenantMembers).where(sql`tenant_id = ${IDS.tenant}`);
    await db.delete(schema.roles).where(sql`tenant_id = ${IDS.tenant}`);
    await db.delete(schema.tenants).where(sql`id = ${IDS.tenant}`);
    await db.delete(schema.users).where(sql`id IN (${sql.raw(Object.values(IDS.users).map(v => `'${v}'`).join(','))})`);

    log('🧹', 'Cleaned existing seed data');

    // ========================================================================
    // USERS
    // ========================================================================
    logSection('Seeding Users');

    const passwordHash = await bcrypt.hash('password123', 12);

    await db.insert(schema.users).values([
      {
        id: IDS.users.admin,
        email: 'admin@test.com',
        passwordHash,
        fullName: 'Admin User',
        isSuperAdmin: true,
        emailVerified: true,
        timezone: 'America/New_York',
        lastTenantId: IDS.tenant,
        defaultTenantId: IDS.tenant,
      },
      {
        id: IDS.users.manager,
        email: 'manager@test.com',
        passwordHash,
        fullName: 'Sarah Manager',
        isSuperAdmin: false,
        emailVerified: true,
        timezone: 'America/Chicago',
        lastTenantId: IDS.tenant,
        defaultTenantId: IDS.tenant,
      },
      {
        id: IDS.users.rep1,
        email: 'rep1@test.com',
        passwordHash,
        fullName: 'Jake Sales',
        isSuperAdmin: false,
        emailVerified: true,
        timezone: 'America/Los_Angeles',
        lastTenantId: IDS.tenant,
        defaultTenantId: IDS.tenant,
      },
      {
        id: IDS.users.rep2,
        email: 'rep2@test.com',
        passwordHash,
        fullName: 'Mia Closer',
        isSuperAdmin: false,
        emailVerified: true,
        timezone: 'Europe/London',
        lastTenantId: IDS.tenant,
        defaultTenantId: IDS.tenant,
      },
    ]);
    logDone('users', 4);

    // ========================================================================
    // TENANT
    // ========================================================================
    logSection('Seeding Tenant');

    await db.insert(schema.tenants).values({
      id: IDS.tenant,
      name: 'NuCRM Demo Workspace',
      slug: 'demo',
      status: 'active',
      planId: 'starter',
      ownerId: IDS.users.admin,
      primaryColor: '#7c3aed',
      billingEmail: 'billing@nucrm-demo.com',
      industry: 'Technology',
      companySize: '11-50',
      country: 'US',
    });
    logDone('tenants', 1);

    // ========================================================================
    // ROLES
    // ========================================================================
    logSection('Seeding Roles');

    await db.insert(schema.roles).values([
      {
        id: IDS.roles.superAdmin,
        tenantId: IDS.tenant,
        name: 'Super Admin',
        slug: 'super_admin',
        description: 'Full system access',
        isSystem: true,
        permissions: { '*': true },
        sortOrder: 0,
      },
      {
        id: IDS.roles.admin,
        tenantId: IDS.tenant,
        name: 'Admin',
        slug: 'admin',
        description: 'Workspace admin access',
        isSystem: true,
        permissions: { contacts: 'full', deals: 'full', settings: 'full', users: 'manage', reports: 'full' },
        sortOrder: 1,
      },
      {
        id: IDS.roles.salesRep,
        tenantId: IDS.tenant,
        name: 'Sales Rep',
        slug: 'sales_rep',
        description: 'Sales team member',
        isSystem: true,
        permissions: { contacts: 'full', deals: 'full', tasks: 'full', reports: 'read' },
        sortOrder: 2,
      },
      {
        id: IDS.roles.member,
        tenantId: IDS.tenant,
        name: 'Member',
        slug: 'member',
        description: 'Basic workspace member',
        isSystem: true,
        permissions: { contacts: 'read', deals: 'read', tasks: 'own' },
        sortOrder: 3,
      },
    ]);
    logDone('roles', 4);

    // ========================================================================
    // TENANT MEMBERS
    // ========================================================================
    logSection('Seeding Tenant Members');

    await db.insert(schema.tenantMembers).values([
      { tenantId: IDS.tenant, userId: IDS.users.admin, roleId: IDS.roles.superAdmin, roleSlug: 'super_admin', status: 'active' },
      { tenantId: IDS.tenant, userId: IDS.users.manager, roleId: IDS.roles.admin, roleSlug: 'admin', status: 'active' },
      { tenantId: IDS.tenant, userId: IDS.users.rep1, roleId: IDS.roles.salesRep, roleSlug: 'sales_rep', status: 'active' },
      { tenantId: IDS.tenant, userId: IDS.users.rep2, roleId: IDS.roles.salesRep, roleSlug: 'sales_rep', status: 'active' },
    ]);
    logDone('tenant_members', 4);


    // ========================================================================
    // COMPANIES (30)
    // ========================================================================
    logSection('Seeding Companies');

    const companiesData = [
      { name: 'TechVision Inc', industry: 'Technology', domain: 'techvision.io', companySize: '51-200', annualRevenue: '5000000', city: 'San Francisco', country: 'US' },
      { name: 'HealthFirst Corp', industry: 'Healthcare', domain: 'healthfirst.com', companySize: '201-500', annualRevenue: '25000000', city: 'Boston', country: 'US' },
      { name: 'FinanceFlow Ltd', industry: 'Finance', domain: 'financeflow.co', companySize: '11-50', annualRevenue: '3000000', city: 'New York', country: 'US' },
      { name: 'BuildRight Manufacturing', industry: 'Manufacturing', domain: 'buildright.com', companySize: '501-1000', annualRevenue: '50000000', city: 'Detroit', country: 'US' },
      { name: 'RetailHub', industry: 'Retail', domain: 'retailhub.io', companySize: '51-200', annualRevenue: '8000000', city: 'Chicago', country: 'US' },
      { name: 'EduSmart Solutions', industry: 'Education', domain: 'edusmart.io', companySize: '11-50', annualRevenue: '1500000', city: 'Austin', country: 'US' },
      { name: 'GreenEnergy Systems', industry: 'Energy', domain: 'greenenergy.co', companySize: '201-500', annualRevenue: '35000000', city: 'Denver', country: 'US' },
      { name: 'LogiTrans Corp', industry: 'Logistics', domain: 'logitrans.com', companySize: '1001-5000', annualRevenue: '120000000', city: 'Memphis', country: 'US' },
      { name: 'MediaWave Digital', industry: 'Media', domain: 'mediawave.io', companySize: '11-50', annualRevenue: '2000000', city: 'Los Angeles', country: 'US' },
      { name: 'AeroSpace Dynamics', industry: 'Aerospace', domain: 'aerodynamics.com', companySize: '5001+', annualRevenue: '500000000', city: 'Seattle', country: 'US' },
      { name: 'DataStream Analytics', industry: 'Technology', domain: 'datastream.ai', companySize: '51-200', annualRevenue: '12000000', city: 'Portland', country: 'US' },
      { name: 'CloudNine Hosting', industry: 'Technology', domain: 'cloudnine.io', companySize: '11-50', annualRevenue: '4000000', city: 'Raleigh', country: 'US' },
      { name: 'BioGen Pharma', industry: 'Healthcare', domain: 'biogenpharma.com', companySize: '201-500', annualRevenue: '45000000', city: 'San Diego', country: 'US' },
      { name: 'FoodTech Innovations', industry: 'Food & Beverage', domain: 'foodtech.co', companySize: '51-200', annualRevenue: '7000000', city: 'Nashville', country: 'US' },
      { name: 'AutoDrive Motors', industry: 'Automotive', domain: 'autodrive.com', companySize: '1001-5000', annualRevenue: '200000000', city: 'Detroit', country: 'US' },
      { name: 'PropTech Realty', industry: 'Real Estate', domain: 'proptech.io', companySize: '11-50', annualRevenue: '6000000', city: 'Miami', country: 'US' },
      { name: 'CyberShield Security', industry: 'Technology', domain: 'cybershield.io', companySize: '51-200', annualRevenue: '15000000', city: 'Washington DC', country: 'US' },
      { name: 'AgriGrow Farms', industry: 'Agriculture', domain: 'agrigrow.co', companySize: '201-500', annualRevenue: '20000000', city: 'Des Moines', country: 'US' },
      { name: 'LegalEase Partners', industry: 'Legal', domain: 'legalease.com', companySize: '11-50', annualRevenue: '5000000', city: 'Philadelphia', country: 'US' },
      { name: 'SportsFit Corp', industry: 'Sports & Fitness', domain: 'sportsfit.io', companySize: '51-200', annualRevenue: '9000000', city: 'Denver', country: 'US' },
      { name: 'TravelWise Inc', industry: 'Travel', domain: 'travelwise.com', companySize: '201-500', annualRevenue: '30000000', city: 'Orlando', country: 'US' },
      { name: 'InsureSafe Group', industry: 'Insurance', domain: 'insuresafe.co', companySize: '501-1000', annualRevenue: '80000000', city: 'Hartford', country: 'US' },
      { name: 'NanoTech Labs', industry: 'Technology', domain: 'nanotech.io', companySize: '11-50', annualRevenue: '3500000', city: 'Cambridge', country: 'US' },
      { name: 'Global Consulting Group', industry: 'Consulting', domain: 'globalcg.com', companySize: '201-500', annualRevenue: '40000000', city: 'Chicago', country: 'US' },
      { name: 'SmartHome Devices', industry: 'Consumer Electronics', domain: 'smarthomed.io', companySize: '51-200', annualRevenue: '11000000', city: 'San Jose', country: 'US' },
      { name: 'OceanBlue Shipping', industry: 'Logistics', domain: 'oceanblue.com', companySize: '1001-5000', annualRevenue: '150000000', city: 'Houston', country: 'US' },
      { name: 'Pixel Perfect Design', industry: 'Design', domain: 'pixelperfect.io', companySize: '1-10', annualRevenue: '800000', city: 'Brooklyn', country: 'US' },
      { name: 'BlockChain Ventures', industry: 'Technology', domain: 'bcventures.io', companySize: '11-50', annualRevenue: '6000000', city: 'Miami', country: 'US' },
      { name: 'PharmaCore Labs', industry: 'Healthcare', domain: 'pharmacore.com', companySize: '501-1000', annualRevenue: '75000000', city: 'Philadelphia', country: 'US' },
      { name: 'WindPower Systems', industry: 'Energy', domain: 'windpower.co', companySize: '201-500', annualRevenue: '28000000', city: 'Oklahoma City', country: 'US' },
    ];

    await db.insert(schema.companies).values(
      companiesData.map((c, i) => ({
        id: IDS.companies[i],
        tenantId: IDS.tenant,
        name: c.name,
        industry: c.industry,
        domain: c.domain,
        companySize: c.companySize,
        annualRevenue: c.annualRevenue,
        city: c.city,
        country: c.country,
        website: `https://${c.domain}`,
        isCustomer: i < 10,
        tags: i % 3 === 0 ? ['enterprise', 'priority'] : i % 3 === 1 ? ['smb'] : ['prospect'],
      }))
    );
    logDone('companies', companiesData.length);


    // ========================================================================
    // CONTACTS (55)
    // ========================================================================
    logSection('Seeding Contacts');

    const firstNames = ['James', 'Emma', 'Oliver', 'Sophia', 'Liam', 'Ava', 'Noah', 'Isabella', 'Ethan', 'Mia', 'Lucas', 'Charlotte', 'Mason', 'Amelia', 'Logan', 'Harper', 'Alexander', 'Evelyn', 'Daniel', 'Abigail', 'Henry', 'Emily', 'Sebastian', 'Elizabeth', 'Jack', 'Sofia', 'Benjamin', 'Ella', 'William', 'Grace', 'Owen', 'Chloe', 'Elijah', 'Victoria', 'Aiden', 'Riley', 'Jackson', 'Zoey', 'Matthew', 'Penelope', 'David', 'Lily', 'Joseph', 'Layla', 'Carter', 'Nora', 'Michael', 'Camila', 'Jayden', 'Hannah', 'Wyatt', 'Aria', 'Gabriel', 'Scarlett', 'Julian'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker'];
    const jobTitles = ['CEO', 'CTO', 'VP Sales', 'VP Engineering', 'Director of Marketing', 'Product Manager', 'Sales Manager', 'Account Executive', 'Software Engineer', 'HR Director', 'CFO', 'COO', 'Business Development Manager', 'Marketing Manager', 'Operations Manager'];
    const leadStatuses = ['new', 'contacted', 'qualified', 'customer'];
    const lifecycleStages = ['subscriber', 'lead', 'mql', 'sql', 'opportunity', 'customer', 'evangelist'];
    const userIds = Object.values(IDS.users);

    const contactsValues = Array.from({ length: 55 }, (_, i) => ({
      id: IDS.contacts[i],
      tenantId: IDS.tenant,
      companyId: IDS.companies[i % 30],
      assignedTo: userIds[i % 4],
      firstName: firstNames[i],
      lastName: lastNames[i],
      email: `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@${companiesData[i % 30].domain}`,
      phone: `+1${String(2000000000 + i * 1111111).slice(0, 10)}`,
      jobTitle: jobTitles[i % jobTitles.length],
      leadStatus: leadStatuses[i % 4],
      lifecycleStage: lifecycleStages[i % 7],
      score: (i * 7 + 10) % 100,
      tags: i % 4 === 0 ? ['vip', 'decision-maker'] : i % 4 === 1 ? ['technical'] : i % 4 === 2 ? ['nurture'] : ['champion'],
      city: companiesData[i % 30].city,
      country: 'US',
    }));

    await db.insert(schema.contacts).values(contactsValues);
    logDone('contacts', 55);

    // ========================================================================
    // LEADS (25)
    // ========================================================================
    logSection('Seeding Leads');

    const leadStatusOptions = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
    const leadSources = ['website', 'referral', 'linkedin', 'cold_call', 'trade_show', 'webinar', 'partner'];

    const leadsValues = Array.from({ length: 25 }, (_, i) => ({
      id: IDS.leads[i],
      tenantId: IDS.tenant,
      firstName: firstNames[54 - i] || firstNames[i],
      lastName: lastNames[54 - i] || lastNames[i],
      email: `lead${i + 1}@example-${i % 10}.com`,
      phone: `+1${String(3000000000 + i * 1234567).slice(0, 10)}`,
      companyName: companiesData[(i + 15) % 30].name,
      source: leadSources[i % leadSources.length],
      leadStatus: leadStatusOptions[i % 6],
      score: (i * 11 + 20) % 100,
      value: String((i + 1) * 5000),
      assignedTo: userIds[i % 4],
      tags: i % 3 === 0 ? ['hot', 'inbound'] : i % 3 === 1 ? ['cold'] : ['warm', 'referral'],
    }));

    await db.insert(schema.leads).values(leadsValues);
    logDone('leads', 25);

    // ========================================================================
    // PIPELINES & STAGES
    // ========================================================================
    logSection('Seeding Pipelines & Deal Stages');

    await db.insert(schema.pipelines).values([
      { id: IDS.pipelines.sales, tenantId: IDS.tenant, name: 'Sales Pipeline', description: 'Standard sales process', isDefault: true },
      { id: IDS.pipelines.enterprise, tenantId: IDS.tenant, name: 'Enterprise Pipeline', description: 'Enterprise deal flow' },
    ]);

    await db.insert(schema.dealStages).values([
      { id: IDS.stages.lead, pipelineId: IDS.pipelines.sales, name: 'Lead', order: 1 },
      { id: IDS.stages.qualified, pipelineId: IDS.pipelines.sales, name: 'Qualified', order: 2 },
      { id: IDS.stages.proposal, pipelineId: IDS.pipelines.sales, name: 'Proposal', order: 3 },
      { id: IDS.stages.negotiation, pipelineId: IDS.pipelines.sales, name: 'Negotiation', order: 4 },
      { id: IDS.stages.closedWon, pipelineId: IDS.pipelines.sales, name: 'Closed Won', order: 5 },
      { id: IDS.stages.closedLost, pipelineId: IDS.pipelines.sales, name: 'Closed Lost', order: 6 },
      { id: IDS.stages.discovery, pipelineId: IDS.pipelines.enterprise, name: 'Discovery', order: 1 },
      { id: IDS.stages.evaluation, pipelineId: IDS.pipelines.enterprise, name: 'Evaluation', order: 2 },
      { id: IDS.stages.poc, pipelineId: IDS.pipelines.enterprise, name: 'POC', order: 3 },
      { id: IDS.stages.contract, pipelineId: IDS.pipelines.enterprise, name: 'Contract', order: 4 },
      { id: IDS.stages.entWon, pipelineId: IDS.pipelines.enterprise, name: 'Won', order: 5 },
      { id: IDS.stages.entLost, pipelineId: IDS.pipelines.enterprise, name: 'Lost', order: 6 },
    ]);
    logDone('pipelines', 2);
    logDone('deal_stages', 12);


    // ========================================================================
    // DEALS (35)
    // ========================================================================
    logSection('Seeding Deals');

    const allStages = [
      IDS.stages.lead, IDS.stages.qualified, IDS.stages.proposal,
      IDS.stages.negotiation, IDS.stages.closedWon, IDS.stages.closedLost,
      IDS.stages.discovery, IDS.stages.evaluation, IDS.stages.poc,
      IDS.stages.contract, IDS.stages.entWon, IDS.stages.entLost,
    ];
    const dealTitles = [
      'CRM License Deal', 'Enterprise Upgrade', 'Annual Subscription', 'Custom Integration',
      'Platform Migration', 'Support Contract', 'Training Package', 'API Access Deal',
      'Multi-Seat License', 'Premium Support', 'Data Analytics Add-on', 'White-Label Agreement',
      'Consulting Engagement', 'Security Audit', 'Performance Optimization', 'Cloud Migration',
      'Compliance Package', 'AI Module Upsell', 'Channel Partnership', 'Reseller Agreement',
      'Proof of Concept', 'Pilot Program', 'Volume Discount Deal', 'Strategic Partnership',
      'Renewal Deal', 'Expansion Deal', 'New Business Win', 'Competitive Displacement',
      'Referral Deal', 'Inbound Deal', 'Outbound Deal', 'Event Lead Deal',
      'Executive Sponsorship', 'Technical Evaluation', 'Budget Approval',
    ];

    const dealsValues = Array.from({ length: 35 }, (_, i) => {
      const isSalesPipeline = i < 20;
      const pipelineId = isSalesPipeline ? IDS.pipelines.sales : IDS.pipelines.enterprise;
      const stageId = isSalesPipeline
        ? allStages[i % 6]
        : allStages[6 + (i % 6)];
      return {
        id: IDS.deals[i],
        tenantId: IDS.tenant,
        contactId: IDS.contacts[i % 55],
        companyId: IDS.companies[i % 30],
        pipelineId,
        stageId,
        title: dealTitles[i],
        amount: String(5000 + (i * 14321) % 495000),
        closeDate: i % 3 === 0 ? pastDate(i * 3) : futureDate(i * 7),
        assignedTo: userIds[i % 4],
      };
    });

    await db.insert(schema.deals).values(dealsValues);
    logDone('deals', 35);

    // ========================================================================
    // TASKS (18)
    // ========================================================================
    logSection('Seeding Tasks');

    const taskPriorities = ['low', 'medium', 'high', 'urgent'] as const;
    const taskStatuses = ['pending', 'completed', 'cancelled'] as const;
    const taskTitles = [
      'Follow up with client', 'Send proposal', 'Schedule demo', 'Review contract',
      'Update CRM records', 'Prepare presentation', 'Call back lead', 'Send invoice',
      'Onboard new customer', 'Write case study', 'Team sync meeting', 'Pipeline review',
      'Qualify new leads', 'Set up integration', 'Train new rep', 'Renew subscription',
      'Negotiate terms', 'Close Q4 deals',
    ];

    const tasksValues = Array.from({ length: 18 }, (_, i) => ({
      id: IDS.tasks[i],
      tenantId: IDS.tenant,
      title: taskTitles[i],
      description: `Task details for: ${taskTitles[i]}`,
      priority: taskPriorities[i % 4],
      status: taskStatuses[i % 3],
      dueDate: i % 2 === 0 ? futureDate(i + 1) : pastDate(i),
      completed: taskStatuses[i % 3] === 'completed',
      completedAt: taskStatuses[i % 3] === 'completed' ? pastDate(1) : null,
      contactId: IDS.contacts[i % 55],
      dealId: IDS.deals[i % 35],
      assignedTo: userIds[i % 4],
    }));

    await db.insert(schema.tasks).values(tasksValues);
    logDone('tasks', 18);

    // ========================================================================
    // SUPPORT TICKETS (12) + REPLIES
    // ========================================================================
    logSection('Seeding Support Tickets');

    const ticketStatuses = ['open', 'in_progress', 'resolved', 'closed'] as const;
    const ticketPriorities = ['low', 'medium', 'high', 'urgent'] as const;
    const ticketCategories = ['general', 'billing', 'technical', 'feature_request'];
    const ticketSubjects = [
      'Cannot export contacts', 'Billing discrepancy', 'API rate limit reached',
      'Feature request: Bulk email', 'Login issues after update', 'Dashboard not loading',
      'Integration with Slack broken', 'Need help with automation', 'Custom field not saving',
      'Report generation timeout', 'Mobile app crash', 'Permission issue for team member',
    ];

    const ticketsValues = Array.from({ length: 12 }, (_, i) => ({
      id: IDS.tickets[i],
      tenantId: IDS.tenant,
      contactId: IDS.contacts[i % 55],
      subject: ticketSubjects[i],
      body: `Detailed description for ticket: ${ticketSubjects[i]}. This needs attention.`,
      status: ticketStatuses[i % 4],
      priority: ticketPriorities[i % 4],
      category: ticketCategories[i % 4],
      assignedTo: userIds[i % 4],
      resolvedAt: ticketStatuses[i % 4] === 'resolved' ? pastDate(2) : null,
    }));

    await db.insert(schema.supportTickets).values(ticketsValues);
    logDone('support_tickets', 12);

    // Ticket replies
    const repliesValues = Array.from({ length: 20 }, (_, i) => ({
      ticketId: IDS.tickets[i % 12],
      tenantId: IDS.tenant,
      userId: userIds[i % 4],
      body: `Reply #${i + 1}: Working on this issue. ${i % 2 === 0 ? 'Escalated to engineering.' : 'Will update shortly.'}`,
      isInternal: i % 3 === 0,
    }));

    await db.insert(schema.ticketReplies).values(repliesValues);
    logDone('ticket_replies', 20);


    // ========================================================================
    // ACTIVITIES (25)
    // ========================================================================
    logSection('Seeding Activities');

    const eventTypes = ['email_sent', 'call_made', 'meeting_scheduled', 'note_added', 'deal_updated', 'contact_created', 'task_completed'];
    const entityTypes = ['contact', 'deal', 'company'];

    const activitiesValues = Array.from({ length: 25 }, (_, i) => ({
      tenantId: IDS.tenant,
      userId: userIds[i % 4],
      entityType: entityTypes[i % 3],
      entityId: entityTypes[i % 3] === 'contact' ? IDS.contacts[i % 55] : entityTypes[i % 3] === 'deal' ? IDS.deals[i % 35] : IDS.companies[i % 30],
      contactId: i % 3 === 0 ? IDS.contacts[i % 55] : null,
      dealId: i % 3 === 1 ? IDS.deals[i % 35] : null,
      companyId: i % 3 === 2 ? IDS.companies[i % 30] : null,
      eventType: eventTypes[i % eventTypes.length],
      description: `Activity: ${eventTypes[i % eventTypes.length]} by user ${i % 4 + 1}`,
    }));

    await db.insert(schema.activities).values(activitiesValues);
    logDone('activities', 25);

    // ========================================================================
    // EMAIL LOG (8) + EMAIL TEMPLATES (3)
    // ========================================================================
    logSection('Seeding Email Data');

    const emailLogValues = Array.from({ length: 8 }, (_, i) => ({
      tenantId: IDS.tenant,
      contactId: IDS.contacts[i % 55],
      fromEmail: 'noreply@nucrm-demo.com',
      toEmail: `${firstNames[i].toLowerCase()}@${companiesData[i % 30].domain}`,
      subject: `Follow up - ${companiesData[i % 30].name}`,
      body: `Hi ${firstNames[i]}, just following up on our conversation...`,
      status: i % 3 === 0 ? 'failed' : 'sent',
      provider: 'resend',
      sentAt: i % 3 === 0 ? null : pastDate(i),
      errorMessage: i % 3 === 0 ? 'Recipient mailbox full' : null,
    }));

    await db.insert(schema.emailLog).values(emailLogValues);
    logDone('email_log', 8);

    await db.insert(schema.emailTemplates).values([
      {
        tenantId: IDS.tenant,
        name: 'Welcome Email',
        subject: 'Welcome to {{company_name}}!',
        bodyHtml: '<h1>Welcome!</h1><p>Thanks for joining us, {{first_name}}.</p>',
        bodyText: 'Welcome! Thanks for joining us.',
        category: 'onboarding',
      },
      {
        tenantId: IDS.tenant,
        name: 'Follow Up',
        subject: 'Following up on our conversation',
        bodyHtml: '<p>Hi {{first_name}},</p><p>Just wanted to follow up...</p>',
        bodyText: 'Hi, just wanted to follow up...',
        category: 'sales',
      },
      {
        tenantId: IDS.tenant,
        name: 'Deal Won Notification',
        subject: 'Congratulations! Deal Closed',
        bodyHtml: '<h2>Deal Closed!</h2><p>The deal "{{deal_title}}" has been marked as won.</p>',
        bodyText: 'Deal Closed! The deal has been marked as won.',
        category: 'notifications',
      },
    ]);
    logDone('email_templates', 3);

    // ========================================================================
    // FORMS (3) + SUBMISSIONS (8)
    // ========================================================================
    logSection('Seeding Forms');

    await db.insert(schema.forms).values([
      {
        id: IDS.forms[0],
        tenantId: IDS.tenant,
        name: 'Contact Us',
        slug: 'contact-us',
        title: 'Get in Touch',
        description: 'We would love to hear from you',
        fields: [
          { key: 'name', label: 'Full Name', type: 'text', required: true },
          { key: 'email', label: 'Email', type: 'email', required: true },
          { key: 'message', label: 'Message', type: 'textarea', required: true },
        ],
        isActive: true,
        submissionsCount: 3,
      },
      {
        id: IDS.forms[1],
        tenantId: IDS.tenant,
        name: 'Demo Request',
        slug: 'demo-request',
        title: 'Schedule a Demo',
        description: 'See NuCRM in action',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'email', label: 'Work Email', type: 'email', required: true },
          { key: 'company', label: 'Company', type: 'text', required: true },
          { key: 'size', label: 'Team Size', type: 'select', options: ['1-10', '11-50', '51-200', '200+'] },
        ],
        isActive: true,
        submissionsCount: 3,
      },
      {
        id: IDS.forms[2],
        tenantId: IDS.tenant,
        name: 'Newsletter',
        slug: 'newsletter-signup',
        title: 'Subscribe to Our Newsletter',
        description: 'Get the latest updates',
        fields: [
          { key: 'email', label: 'Email Address', type: 'email', required: true },
          { key: 'interests', label: 'Interests', type: 'checkbox', options: ['Product Updates', 'Industry News', 'Tips & Tricks'] },
        ],
        isActive: true,
        submissionsCount: 2,
      },
    ]);
    logDone('forms', 3);

    const submissionsValues = Array.from({ length: 8 }, (_, i) => ({
      formId: IDS.forms[i % 3],
      tenantId: IDS.tenant,
      data: { name: `Submitter ${i + 1}`, email: `submitter${i + 1}@example.com`, message: `Form submission #${i + 1}` },
      submittedBy: `submitter${i + 1}@example.com`,
      sourceUrl: `https://nucrm-demo.com/forms/${['contact-us', 'demo-request', 'newsletter-signup'][i % 3]}`,
    }));

    await db.insert(schema.formSubmissions).values(submissionsValues);
    logDone('form_submissions', 8);


    // ========================================================================
    // SEQUENCES (2) + STEPS + ENROLLMENTS
    // ========================================================================
    logSection('Seeding Sequences');

    await db.insert(schema.sequences).values([
      { id: IDS.sequences.onboarding, tenantId: IDS.tenant, name: 'Onboarding Drip', description: 'Welcome sequence for new customers', status: 'active', enrollCount: 15 },
      { id: IDS.sequences.reengagement, tenantId: IDS.tenant, name: 'Re-engagement Campaign', description: 'Win back inactive contacts', status: 'active', enrollCount: 8 },
    ]);
    logDone('sequences', 2);

    const sequenceStepsValues = [
      { sequenceId: IDS.sequences.onboarding, tenantId: IDS.tenant, stepNumber: 1, stepType: 'email', delayDays: 0, subject: 'Welcome aboard!', body: 'Thanks for signing up...' },
      { sequenceId: IDS.sequences.onboarding, tenantId: IDS.tenant, stepNumber: 2, stepType: 'delay', delayDays: 2, subject: '', body: '' },
      { sequenceId: IDS.sequences.onboarding, tenantId: IDS.tenant, stepNumber: 3, stepType: 'email', delayDays: 0, subject: 'Getting started tips', body: 'Here are some tips...' },
      { sequenceId: IDS.sequences.onboarding, tenantId: IDS.tenant, stepNumber: 4, stepType: 'task', delayDays: 5, subject: 'Check-in call', body: 'Schedule a check-in call' },
      { sequenceId: IDS.sequences.reengagement, tenantId: IDS.tenant, stepNumber: 1, stepType: 'email', delayDays: 0, subject: 'We miss you!', body: 'It has been a while...' },
      { sequenceId: IDS.sequences.reengagement, tenantId: IDS.tenant, stepNumber: 2, stepType: 'delay', delayDays: 3, subject: '', body: '' },
      { sequenceId: IDS.sequences.reengagement, tenantId: IDS.tenant, stepNumber: 3, stepType: 'email', delayDays: 0, subject: 'Special offer inside', body: 'We have a special offer for you...' },
    ];

    await db.insert(schema.sequenceSteps).values(sequenceStepsValues);
    logDone('sequence_steps', 7);

    const enrollmentsValues = Array.from({ length: 8 }, (_, i) => ({
      tenantId: IDS.tenant,
      sequenceId: i < 5 ? IDS.sequences.onboarding : IDS.sequences.reengagement,
      contactId: IDS.contacts[i + 10],
      status: i % 3 === 0 ? 'completed' : 'active',
      currentStep: (i % 4) + 1,
      enrolledBy: userIds[i % 4],
    }));

    await db.insert(schema.sequenceEnrollments).values(enrollmentsValues);
    logDone('sequence_enrollments', 8);

    // ========================================================================
    // PRODUCTS (6) + QUOTES (5) + LINE ITEMS
    // ========================================================================
    logSection('Seeding Products & Quotes');

    const productsData = [
      { name: 'CRM License (Monthly)', sku: 'CRM-M-001', basePrice: '49.00' },
      { name: 'CRM License (Annual)', sku: 'CRM-A-001', basePrice: '490.00' },
      { name: 'Support Plan - Standard', sku: 'SUP-STD-001', basePrice: '199.00' },
      { name: 'Support Plan - Premium', sku: 'SUP-PRM-001', basePrice: '499.00' },
      { name: 'Custom Development (per hour)', sku: 'DEV-HR-001', basePrice: '150.00' },
      { name: 'Training Workshop', sku: 'TRN-WS-001', basePrice: '2500.00' },
    ];

    await db.insert(schema.products).values(
      productsData.map((p, i) => ({
        id: IDS.products[i],
        tenantId: IDS.tenant,
        name: p.name,
        sku: p.sku,
        basePrice: p.basePrice,
        description: `${p.name} - standard offering`,
      }))
    );
    logDone('products', 6);

    const quotesValues = Array.from({ length: 5 }, (_, i) => ({
      id: IDS.quotes[i],
      tenantId: IDS.tenant,
      contactId: IDS.contacts[i],
      dealId: IDS.deals[i],
      title: `Quote for ${companiesData[i].name}`,
      quoteNumber: `Q-2024-${String(i + 1).padStart(4, '0')}`,
      status: ['draft', 'sent', 'accepted', 'sent', 'declined'][i],
      subtotal: String(5000 + i * 3000),
      tax: String((5000 + i * 3000) * 0.08),
      totalAmount: String((5000 + i * 3000) * 1.08),
      expiresAt: futureDate(30),
    }));

    await db.insert(schema.quotes).values(quotesValues);
    logDone('quotes', 5);

    const lineItemsValues = Array.from({ length: 12 }, (_, i) => ({
      quoteId: IDS.quotes[i % 5],
      productId: IDS.products[i % 6],
      description: productsData[i % 6].name,
      quantity: String(Math.ceil((i + 1) / 2)),
      unitPrice: productsData[i % 6].basePrice,
      total: String(parseFloat(productsData[i % 6].basePrice) * Math.ceil((i + 1) / 2)),
    }));

    await db.insert(schema.quoteLineItems).values(lineItemsValues);
    logDone('quote_line_items', 12);

    // ========================================================================
    // FINANCIAL DATA
    // ========================================================================
    logSection('Seeding Financial Data');

    await db.insert(schema.taxRates).values([
      { tenantId: IDS.tenant, name: 'US Sales Tax', rate: '8.0000', type: 'percentage', country: 'US', state: 'CA', isDefault: true },
      { tenantId: IDS.tenant, name: 'US Sales Tax (NY)', rate: '8.8750', type: 'percentage', country: 'US', state: 'NY' },
      { tenantId: IDS.tenant, name: 'EU VAT', rate: '20.0000', type: 'percentage', country: 'EU' },
    ]);
    logDone('tax_rates', 3);

    await db.insert(schema.exchangeRates).values([
      { baseCurrency: 'USD', targetCurrency: 'EUR', rate: '0.92150000', source: 'exchangerate-api' },
      { baseCurrency: 'USD', targetCurrency: 'GBP', rate: '0.79230000', source: 'exchangerate-api' },
    ]).onConflictDoNothing();
    logDone('exchange_rates', 2);


    // ========================================================================
    // AI ACTIVITY (8)
    // ========================================================================
    logSection('Seeding AI Activity');

    const aiActions = ['draft', 'lead_scoring', 'predict_deal', 'enrich_contact', 'suggest_followup'];
    const aiProviders = ['anthropic', 'openai'];

    const aiActivityValues = Array.from({ length: 8 }, (_, i) => ({
      tenantId: IDS.tenant,
      userId: userIds[i % 4],
      action: aiActions[i % aiActions.length],
      provider: aiProviders[i % 2],
      model: i % 2 === 0 ? 'claude-3-5-sonnet' : 'gpt-4o-mini',
      status: i === 5 ? 'error' : 'success',
      tokensIn: 200 + i * 50,
      tokensOut: 300 + i * 80,
      tokensUsed: 500 + i * 130,
      latencyMs: 800 + i * 200,
      entityType: i % 2 === 0 ? 'contact' : 'deal',
      entityId: i % 2 === 0 ? IDS.contacts[i] : IDS.deals[i],
      errorMessage: i === 5 ? 'Rate limit exceeded' : null,
      accepted: i % 3 !== 0,
    }));

    await db.insert(schema.aiActivity).values(aiActivityValues);
    logDone('ai_activity', 8);

    // ========================================================================
    // MODULES & TENANT MODULES
    // ========================================================================
    logSection('Seeding Modules');

    await db.insert(schema.modules).values([
      { id: 'core-crm', name: 'Core CRM', version: '1.0.0', description: 'Core CRM functionality', category: 'core', isAvailable: 'true' },
      { id: 'ai-assistant', name: 'AI Assistant', version: '1.0.0', description: 'AI-powered insights and automation', category: 'ai', isAvailable: 'true' },
      { id: 'forms-builder', name: 'Forms Builder', version: '1.0.0', description: 'Build and manage forms', category: 'marketing', isAvailable: 'true' },
      { id: 'automation-engine', name: 'Automation Engine', version: '1.0.0', description: 'Workflow automation', category: 'automation', isAvailable: 'true' },
      { id: 'email-sequences', name: 'Email Sequences', version: '1.0.0', description: 'Drip campaign management', category: 'marketing', isAvailable: 'true' },
    ]).onConflictDoNothing();
    logDone('modules', 5);

    await db.insert(schema.tenantModules).values([
      { tenantId: IDS.tenant, moduleId: 'core-crm', status: 'active', installedBy: IDS.users.admin },
      { tenantId: IDS.tenant, moduleId: 'ai-assistant', status: 'active', installedBy: IDS.users.admin },
      { tenantId: IDS.tenant, moduleId: 'forms-builder', status: 'active', installedBy: IDS.users.admin },
      { tenantId: IDS.tenant, moduleId: 'automation-engine', status: 'active', installedBy: IDS.users.admin },
    ]);
    logDone('tenant_modules', 4);

    // ========================================================================
    // CUSTOM PLUGINS (2) + EXECUTION LOGS
    // ========================================================================
    logSection('Seeding Plugins');

    await db.insert(schema.customPlugins).values([
      {
        id: IDS.plugins.slack,
        tenantId: IDS.tenant,
        userId: IDS.users.admin,
        name: 'Slack Notifier',
        description: 'Send deal notifications to Slack channels',
        baseUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
        authType: 'bearer',
        actions: [
          { name: 'notify_deal_won', method: 'POST', path: '/webhook', description: 'Notify when a deal is won' },
          { name: 'notify_new_lead', method: 'POST', path: '/webhook', description: 'Notify on new lead' },
        ],
        status: 'active',
      },
      {
        id: IDS.plugins.zapier,
        tenantId: IDS.tenant,
        userId: IDS.users.admin,
        name: 'Zapier Integration',
        description: 'Connect with 5000+ apps via Zapier',
        baseUrl: 'https://hooks.zapier.com/hooks/catch/123456',
        authType: 'none',
        actions: [
          { name: 'trigger_zap', method: 'POST', path: '/trigger', description: 'Trigger a Zapier workflow' },
        ],
        status: 'active',
      },
    ]);
    logDone('custom_plugins', 2);

    const pluginLogsValues = Array.from({ length: 5 }, (_, i) => ({
      tenantId: IDS.tenant,
      pluginId: i < 3 ? IDS.plugins.slack : IDS.plugins.zapier,
      actionName: i < 3 ? 'notify_deal_won' : 'trigger_zap',
      method: 'POST',
      url: i < 3 ? 'https://hooks.slack.com/services/T00/B00/xxx/webhook' : 'https://hooks.zapier.com/hooks/catch/123456/trigger',
      responseStatus: i === 2 ? 500 : 200,
      durationMs: 150 + i * 50,
      success: i !== 2,
      errorMessage: i === 2 ? 'Internal server error from Slack' : null,
    }));

    await db.insert(schema.pluginExecutionLogs).values(pluginLogsValues);
    logDone('plugin_execution_logs', 5);

    // ========================================================================
    // CUSTOM FIELD DEFINITIONS (7)
    // ========================================================================
    logSection('Seeding Custom Fields');

    await db.insert(schema.customFieldDefs).values([
      { tenantId: IDS.tenant, entityType: 'contact', fieldKey: 'preferred_language', fieldLabel: 'Preferred Language', fieldType: 'select', fieldOptions: ['English', 'Spanish', 'French', 'German'], displayOrder: 1 },
      { tenantId: IDS.tenant, entityType: 'contact', fieldKey: 'nps_score', fieldLabel: 'NPS Score', fieldType: 'number', displayOrder: 2 },
      { tenantId: IDS.tenant, entityType: 'contact', fieldKey: 'contract_renewal', fieldLabel: 'Contract Renewal Date', fieldType: 'date', displayOrder: 3 },
      { tenantId: IDS.tenant, entityType: 'deal', fieldKey: 'competitor', fieldLabel: 'Main Competitor', fieldType: 'text', displayOrder: 1 },
      { tenantId: IDS.tenant, entityType: 'deal', fieldKey: 'decision_date', fieldLabel: 'Expected Decision Date', fieldType: 'date', displayOrder: 2 },
      { tenantId: IDS.tenant, entityType: 'deal', fieldKey: 'is_strategic', fieldLabel: 'Strategic Deal', fieldType: 'checkbox', displayOrder: 3 },
      { tenantId: IDS.tenant, entityType: 'company', fieldKey: 'account_tier', fieldLabel: 'Account Tier', fieldType: 'select', fieldOptions: ['Bronze', 'Silver', 'Gold', 'Platinum'], displayOrder: 1 },
    ]);
    logDone('custom_field_defs', 7);


    // ========================================================================
    // API KEY + WEBHOOKS + DELIVERIES
    // ========================================================================
    logSection('Seeding API Keys & Webhooks');

    const apiKeyHash = await bcrypt.hash('nucrm_dev_abc123xyz789', 12);
    await db.insert(schema.apiKeys).values({
      id: IDS.apiKey,
      tenantId: IDS.tenant,
      userId: IDS.users.admin,
      name: 'Development API Key',
      keyHash: apiKeyHash,
      prefix: 'nucrm_dev_',
      scopes: ['*'],
      isActive: true,
    });
    logDone('api_keys', 1);

    await db.insert(schema.webhooks).values([
      {
        id: IDS.webhooks.wh1,
        tenantId: IDS.tenant,
        name: 'Deal Events Webhook',
        url: 'https://example.com/webhooks/deals',
        events: ['deal.created', 'deal.updated', 'deal.won', 'deal.lost'],
        secret: 'whsec_dev_secret_123',
        isActive: true,
      },
      {
        id: IDS.webhooks.wh2,
        tenantId: IDS.tenant,
        name: 'Contact Events Webhook',
        url: 'https://example.com/webhooks/contacts',
        events: ['contact.created', 'contact.updated'],
        secret: 'whsec_dev_secret_456',
        isActive: true,
      },
    ]);
    logDone('webhooks', 2);

    const deliveriesValues = Array.from({ length: 6 }, (_, i) => ({
      tenantId: IDS.tenant,
      webhookId: i < 4 ? IDS.webhooks.wh1 : IDS.webhooks.wh2,
      eventType: i < 4 ? 'deal.updated' : 'contact.created',
      payload: { event: i < 4 ? 'deal.updated' : 'contact.created', data: { id: `entity-${i}` } },
      responseStatus: i === 3 ? 500 : 200,
      responseBody: i === 3 ? 'Internal Server Error' : '{"ok":true}',
      durationMs: 100 + i * 30,
      status: i === 3 ? 'failed' : 'success',
    }));

    await db.insert(schema.webhookDeliveries).values(deliveriesValues);
    logDone('webhook_deliveries', 6);

    // ========================================================================
    // NOTIFICATIONS (12)
    // ========================================================================
    logSection('Seeding Notifications');

    const notifTypes = ['info', 'success', 'warning'];
    const notifTitles = [
      'New deal created', 'Task overdue', 'Contact imported', 'Deal won!',
      'New lead assigned', 'Meeting reminder', 'Report ready', 'System update',
      'Weekly summary', 'Quota alert', 'Integration connected', 'New team member',
    ];

    const notifsValues = Array.from({ length: 12 }, (_, i) => ({
      tenantId: IDS.tenant,
      userId: userIds[i % 4],
      title: notifTitles[i],
      body: `Details about: ${notifTitles[i]}`,
      type: notifTypes[i % 3],
      link: i % 2 === 0 ? `/deals/${IDS.deals[i % 35]}` : null,
      readAt: i < 5 ? pastDate(i) : null,
    }));

    await db.insert(schema.notifications).values(notifsValues);
    logDone('notifications', 12);

    // ========================================================================
    // AUDIT LOGS (15)
    // ========================================================================
    logSection('Seeding Audit Logs');

    const auditActions = ['create', 'update', 'delete'];
    const auditEntityTypes = ['contact', 'deal', 'company', 'task', 'user'];

    const auditValues = Array.from({ length: 15 }, (_, i) => ({
      tenantId: IDS.tenant,
      userId: userIds[i % 4],
      action: auditActions[i % 3],
      entityType: auditEntityTypes[i % 5],
      entityId: IDS.contacts[i % 55],
      oldData: i % 3 === 1 ? { status: 'old_value' } : null,
      newData: i % 3 !== 2 ? { status: 'new_value' } : null,
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (dev-seed)',
    }));

    await db.insert(schema.auditLogs).values(auditValues);
    logDone('audit_logs', 15);

    // ========================================================================
    // AUTOMATIONS (2) + RUNS
    // ========================================================================
    logSection('Seeding Automations');

    await db.insert(schema.automations).values([
      {
        id: IDS.automations.auto1,
        tenantId: IDS.tenant,
        name: 'Lead Auto-Assignment',
        description: 'Automatically assigns new leads to available reps using round-robin',
        isActive: true,
        triggerType: 'event',
        triggerConfig: { event: 'lead.created' },
        actions: [
          { type: 'assign', config: { method: 'round_robin', users: Object.values(IDS.users) } },
          { type: 'notify', config: { channel: 'in_app', message: 'New lead assigned to you' } },
        ],
        runCount: 45,
        lastRunAt: pastDate(1),
      },
      {
        id: IDS.automations.auto2,
        tenantId: IDS.tenant,
        name: 'Deal Stage Notification',
        description: 'Sends notifications when deals move to negotiation or closed stages',
        isActive: true,
        triggerType: 'event',
        triggerConfig: { event: 'deal.stage_changed', conditions: { stage: ['negotiation', 'closed_won', 'closed_lost'] } },
        actions: [
          { type: 'notify', config: { channel: 'email', template: 'deal_stage_change' } },
          { type: 'log', config: { message: 'Deal stage changed' } },
        ],
        runCount: 28,
        lastRunAt: pastDate(2),
      },
    ]);
    logDone('automations', 2);

    const runValues = Array.from({ length: 6 }, (_, i) => ({
      automationId: i < 3 ? IDS.automations.auto1 : IDS.automations.auto2,
      tenantId: IDS.tenant,
      status: i === 4 ? 'failed' : 'completed',
      triggerEvent: i < 3 ? 'lead.created' : 'deal.stage_changed',
      triggerEntity: i < 3 ? 'lead' : 'deal',
      triggerEntityId: i < 3 ? IDS.leads[i] : IDS.deals[i],
      finishedAt: pastDate(i),
      stepsCompleted: i === 4 ? 1 : 2,
      totalSteps: 2,
      errorMessage: i === 4 ? 'Failed to send email notification' : null,
    }));

    await db.insert(schema.automationRuns).values(runValues);
    logDone('automation_runs', 6);


    // ========================================================================
    // PLANS
    // ========================================================================
    logSection('Seeding Plans');

    await db.insert(schema.plans).values([
      {
        id: 'free',
        name: 'Free',
        slug: 'free',
        description: 'Get started with basic CRM features',
        priceMonthly: '0',
        priceYearly: '0',
        maxUsers: 2,
        maxContacts: 100,
        maxDeals: 50,
        features: ['basic_crm', 'email_log'],
        sortOrder: 0,
      },
      {
        id: 'starter',
        name: 'Starter',
        slug: 'starter',
        description: 'For growing teams',
        priceMonthly: '29',
        priceYearly: '290',
        maxUsers: 5,
        maxContacts: 1000,
        maxDeals: 500,
        features: ['basic_crm', 'email_log', 'forms', 'automations', 'reports'],
        sortOrder: 1,
      },
      {
        id: 'professional',
        name: 'Professional',
        slug: 'professional',
        description: 'For scaling businesses',
        priceMonthly: '79',
        priceYearly: '790',
        maxUsers: 25,
        maxContacts: 10000,
        maxDeals: 5000,
        features: ['basic_crm', 'email_log', 'forms', 'automations', 'reports', 'ai_assistant', 'sequences', 'api_access'],
        sortOrder: 2,
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        slug: 'enterprise',
        description: 'For large organizations',
        priceMonthly: '199',
        priceYearly: '1990',
        maxUsers: 100,
        maxContacts: 100000,
        maxDeals: 50000,
        features: ['basic_crm', 'email_log', 'forms', 'automations', 'reports', 'ai_assistant', 'sequences', 'api_access', 'sso', 'custom_plugins', 'white_label'],
        sortOrder: 3,
      },
    ]).onConflictDoNothing();
    logDone('plans', 4);

    // ========================================================================
    // DONE!
    // ========================================================================
    console.log('\n\x1b[32m');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║          Seed Complete!                         ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║                                                  ║');
    console.log('║  Login Credentials:                             ║');
    console.log('║  ─────────────────                              ║');
    console.log('║  Super Admin:  admin@test.com / password123     ║');
    console.log('║  Admin:        manager@test.com / password123   ║');
    console.log('║  Sales Rep 1:  rep1@test.com / password123      ║');
    console.log('║  Sales Rep 2:  rep2@test.com / password123      ║');
    console.log('║                                                  ║');
    console.log('║  Tenant: NuCRM Demo Workspace (slug: demo)      ║');
    console.log('║                                                  ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('\x1b[0m');

  } catch (error) {
    console.error('\x1b[31m[ERROR] Seed failed:\x1b[0m', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
