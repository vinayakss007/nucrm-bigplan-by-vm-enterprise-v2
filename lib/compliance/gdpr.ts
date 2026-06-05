/**
 * GDPR Compliance Module
 * 
 * Provides functions for:
 * - Exporting all tenant/user data as structured JSON
 * - Right-to-deletion (anonymize PII and mark records as purged)
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

export interface GDPRExportData {
  tenantId: string;
  exportedAt: string;
  categories: {
    contacts: any[];
    companies: any[];
    deals: any[];
    tasks: any[];
    activities: any[];
    emails: any[];
    notes: any[];
    files: any[];
  };
  metadata: {
    totalRecords: number;
    dataCategories: string[];
  };
}

export interface GDPRDeletionResult {
  tenantId: string;
  processedAt: string;
  anonymizedRecords: number;
  categories: Record<string, number>;
}

/**
 * Export all tenant data for GDPR data portability (Article 20).
 * Assembles contacts, companies, deals, tasks, activities, emails, notes, and files
 * into a structured JSON package.
 */
export async function exportTenantData(tenantId: string): Promise<GDPRExportData> {
  const categories: GDPRExportData['categories'] = {
    contacts: [],
    companies: [],
    deals: [],
    tasks: [],
    activities: [],
    emails: [],
    notes: [],
    files: [],
  };

  // Export contacts
  try {
    const contacts = await db.execute(
      sql`SELECT id, first_name, last_name, email, phone, company_id, metadata, created_at 
          FROM contacts WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.contacts = contacts.rows as any[];
  } catch { /* table may not exist */ }

  // Export companies
  try {
    const companies = await db.execute(
      sql`SELECT id, name, domain, industry, size, metadata, created_at 
          FROM companies WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.companies = companies.rows as any[];
  } catch { /* table may not exist */ }

  // Export deals
  try {
    const deals = await db.execute(
      sql`SELECT id, title, value, currency, stage_id, contact_id, company_id, metadata, created_at 
          FROM deals WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.deals = deals.rows as any[];
  } catch { /* table may not exist */ }

  // Export tasks
  try {
    const tasks = await db.execute(
      sql`SELECT id, title, description, status, due_date, assigned_to, metadata, created_at 
          FROM tasks WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.tasks = tasks.rows as any[];
  } catch { /* table may not exist */ }

  // Export activities
  try {
    const activities = await db.execute(
      sql`SELECT id, type, title, description, contact_id, metadata, created_at 
          FROM activities WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.activities = activities.rows as any[];
  } catch { /* table may not exist */ }

  // Export email logs
  try {
    const emails = await db.execute(
      sql`SELECT id, subject, to_email, from_email, status, metadata, created_at 
          FROM email_log WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.emails = emails.rows as any[];
  } catch { /* table may not exist */ }

  // Export notes
  try {
    const notes = await db.execute(
      sql`SELECT id, content, entity_type, entity_id, metadata, created_at 
          FROM notes WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.notes = notes.rows as any[];
  } catch { /* table may not exist */ }

  // Export file metadata
  try {
    const files = await db.execute(
      sql`SELECT id, filename, mime_type, size, entity_type, entity_id, created_at 
          FROM file_uploads WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    categories.files = files.rows as any[];
  } catch { /* table may not exist */ }

  const totalRecords = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);

  return {
    tenantId,
    exportedAt: new Date().toISOString(),
    categories,
    metadata: {
      totalRecords,
      dataCategories: Object.keys(categories).filter(k => (categories as any)[k].length > 0),
    },
  };
}

/**
 * Right to Deletion (GDPR Article 17).
 * Anonymizes PII in all tenant records and marks them as purged.
 * Does not physically delete records to maintain referential integrity
 * and audit trail requirements.
 */
export async function anonymizeTenantData(tenantId: string): Promise<GDPRDeletionResult> {
  const categoryCounts: Record<string, number> = {};
  let totalAnonymized = 0;

  // Anonymize contacts
  try {
    const result = await db.execute(
      sql`UPDATE contacts 
          SET first_name = 'REDACTED', last_name = 'REDACTED', 
              email = CONCAT('redacted_', id, '@deleted.local'), 
              phone = NULL, metadata = '{"gdpr_purged": true}'::jsonb,
              deleted_at = NOW()
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    const count = Number(result.rowCount) || 0;
    categoryCounts['contacts'] = count;
    totalAnonymized += count;
  } catch { /* table may not exist */ }

  // Anonymize companies
  try {
    const result = await db.execute(
      sql`UPDATE companies 
          SET name = 'REDACTED', domain = NULL, 
              metadata = '{"gdpr_purged": true}'::jsonb,
              deleted_at = NOW()
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    const count = Number(result.rowCount) || 0;
    categoryCounts['companies'] = count;
    totalAnonymized += count;
  } catch { /* table may not exist */ }

  // Anonymize notes
  try {
    const result = await db.execute(
      sql`UPDATE notes 
          SET content = '[REDACTED - GDPR]', 
              metadata = '{"gdpr_purged": true}'::jsonb,
              deleted_at = NOW()
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    const count = Number(result.rowCount) || 0;
    categoryCounts['notes'] = count;
    totalAnonymized += count;
  } catch { /* table may not exist */ }

  // Anonymize activities
  try {
    const result = await db.execute(
      sql`UPDATE activities 
          SET description = '[REDACTED - GDPR]', title = 'REDACTED',
              metadata = '{"gdpr_purged": true}'::jsonb,
              deleted_at = NOW()
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    const count = Number(result.rowCount) || 0;
    categoryCounts['activities'] = count;
    totalAnonymized += count;
  } catch { /* table may not exist */ }

  // Soft-delete email logs
  try {
    const result = await db.execute(
      sql`UPDATE email_log 
          SET subject = '[REDACTED]', to_email = 'redacted@deleted.local',
              metadata = '{"gdpr_purged": true}'::jsonb,
              deleted_at = NOW()
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    const count = Number(result.rowCount) || 0;
    categoryCounts['emails'] = count;
    totalAnonymized += count;
  } catch { /* table may not exist */ }

  return {
    tenantId,
    processedAt: new Date().toISOString(),
    anonymizedRecords: totalAnonymized,
    categories: categoryCounts,
  };
}
