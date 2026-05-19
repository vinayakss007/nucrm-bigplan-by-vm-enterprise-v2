/**
 * Database Performance Indexes
 * Run: npx tsx scripts/add-indexes.ts
 * 
 * Add these indexes to speed up common queries
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

const indexes = [
  // Contacts indexes
  { name: 'idx_contacts_tenant_created', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_created ON contacts(tenant_id, created_at DESC)` },
  { name: 'idx_contacts_tenant_email', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_email ON contacts(tenant_id, email)` },
  { name: 'idx_contacts_tenant_status', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_status ON contacts(tenant_id, status)` },
  { name: 'idx_contacts_company', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_company ON contacts(company_id) WHERE company_id IS NOT NULL` },
  
  // Deals indexes
  { name: 'idx_deals_tenant_stage', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_tenant_stage ON deals(tenant_id, stage_id)` },
  { name: 'idx_deals_tenant_created', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_tenant_created ON deals(tenant_id, created_at DESC)` },
  { name: 'idx_deals_contact', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_contact ON deals(contact_id) WHERE contact_id IS NOT NULL` },
  { name: 'idx_deals_assignee', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_assignee ON deals(assigned_to) WHERE assigned_to IS NOT NULL` },
  
  // Companies indexes
  { name: 'idx_companies_tenant', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_tenant ON companies(tenant_id)` },
  { name: 'idx_companies_domain', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_domain ON companies(domain) WHERE domain IS NOT NULL` },
  
  // Activities indexes
  { name: 'idx_activities_tenant_created', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_tenant_created ON activities(tenant_id, created_at DESC)` },
  { name: 'idx_activities_entity', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id)` },
  { name: 'idx_activities_contact', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_contact ON activities(contact_id) WHERE contact_id IS NOT NULL` },
  
  // Tasks indexes
  { name: 'idx_tasks_tenant_due', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_tenant_due ON tasks(tenant_id, due_date) WHERE due_date IS NOT NULL` },
  { name: 'idx_tasks_assignee', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to) WHERE assigned_to IS NOT NULL` },
  
  // Invoices indexes
  { name: 'idx_invoices_tenant_status', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_status ON invoices(tenant_id, status)` },
  { name: 'idx_invoices_contact', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_contact ON invoices(contact_id) WHERE contact_id IS NOT NULL` },
  
  // Orders indexes
  { name: 'idx_orders_tenant_status', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status)` },
  { name: 'idx_orders_contact', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_contact ON orders(contact_id) WHERE contact_id IS NOT NULL` },
  
  // Full-text search (for contacts/leads search)
  { name: 'idx_contacts_search', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_search ON contacts USING gin(to_tsvector('english', first_name || ' ' || COALESCE(last_name, '') || ' ' || COALESCE(email, '')))` },
  { name: 'idx_companies_search', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_search ON companies USING gin(to_tsvector('english', name || ' ' || COALESCE(domain, '')))` },
  { name: 'idx_deals_search', sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_search ON deals USING gin(to_tsvector('english', title))` },
];

async function addIndexes() {
  console.log('Adding database indexes...\n');
  
  for (const idx of indexes) {
    try {
      console.log(`Adding: ${idx.name}`);
      await db.execute(sql.raw(idx.sql));
      console.log(`  ✓ ${idx.name}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`  - ${idx.name} (already exists)`);
      } else {
        console.error(`  ✗ ${idx.name}: ${error.message}`);
      }
    }
  }
  
  console.log('\nDone!');
}

addIndexes().catch(console.error);
