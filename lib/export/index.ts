/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { contacts, companies, deals, tasks, leads } from '@/drizzle/schema';
import { eq, and, isNull, ilike, or, sql, type SQL } from 'drizzle-orm';
import { addJob } from '@/lib/queue';
import { escapeLike } from '@/lib/api/sanitize-like';
import { notArchived } from '@/lib/api/deals-archive-filter';
import { csvEscapeValue } from '@/lib/csv';

export type ExportEntityType = 'contacts' | 'deals' | 'tasks' | 'companies' | 'leads';

export interface ExportOptions {
  tenantId: string;
  userId: string;
  entityType: ExportEntityType;
 
 
  filters?: Record<string, string | undefined>;
  callbackUrl?: string;
  /**
   * #2677 — the row narrowing the caller's own list route applies, passed in by
   * the route that holds an `AuthContext` (`ownerScope(ctx, 'contacts.view_all',
   * contacts)`). This module has no context of its own and the async export job
   * in `worker.ts` has none to pass, so it stays optional and `and()` skips the
   * undefined: a cron running as a tenant-wide role keeps reading the tenant,
   * while a `sales_rep` pressing Export stops reading rows the UI refuses to
   * show them.
   */
  scope?: SQL | undefined;
  /**
   * #2618 — optional row projection (role field_permissions). Applied after
   * the row-cap check and before headers are derived, so a restricted column
   * disappears from the CSV entirely. Async export jobs (worker.ts) have no
   * AuthContext and stay unprojected.
   */
  project?: (data: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
}

// Maximum contacts per import to prevent system overload
export const MAX_IMPORT_CONTACTS = 1000;

// #H2: Hard cap on rows returned by a single export. Without a LIMIT the query
// streams an entire tenant's dataset into the Node heap (and holds a pooled DB
// connection for the full scan), which can OOM the web process or exhaust the
// pool for large tenants. 50k rows keeps the in-memory CSV bounded (~tens of
// MB) while covering the overwhelming majority of real exports. Callers that
// need more should page (offset filter) or use an async/streamed export.
// Override with EXPORT_MAX_ROWS for operators with different memory budgets.
export const MAX_EXPORT_ROWS = (() => {
  const raw = parseInt(process.env['EXPORT_MAX_ROWS'] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 50_000;
})();

/**
 * Raised when an export would exceed MAX_EXPORT_ROWS. Callers should surface a
 * 413 and prompt the user to narrow their filter or use a paged/async export.
 */
export class ExportLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Export exceeds the maximum of ${limit} rows. Narrow your filter or export in smaller batches.`);
    this.name = 'ExportLimitError';
  }
}

/**
 * Import limit error
 */
export class ImportLimitError extends Error {
  constructor(limit: number, actual: number) {
    super(`Import limit exceeded: maximum ${limit} contacts allowed, but ${actual} provided. Split into multiple batches.`);
    this.name = 'ImportLimitError';
  }
}

/**
 * Characters that can trigger formula execution in spreadsheet applications.
 * Lives in the pure lib/csv module (#2340) so client components can share the
 * exact same guard without importing this server-only module.
 */
 
 

export function escapeCSV(val: unknown): string {
  return csvEscapeValue(val);
}

/**
 * Escapes SQL wildcard characters (% and _) in user-supplied search terms
 * to prevent them from being interpreted as pattern wildcards in ILIKE queries.
 */
export function escapeIlikeWildcards(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Generates CSV string for a given entity type and tenant
 */
export async function generateExportData(opts: Omit<ExportOptions, 'callbackUrl'>): Promise<string> {
  const { tenantId, entityType, filters = {}, scope } = opts;
  
 
 
  let data: Record<string, unknown>[] = [];
  
  switch (entityType) {
    case 'contacts': {
      const q = filters['q'];
      data = await db.select({
        first_name: contacts.firstName,
        last_name: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        company: companies.name,
        lead_status: contacts.leadStatus,
        lead_source: contacts.leadSource,
        city: contacts.city,
        country: contacts.country,
        website: contacts.website,
        linkedin_url: contacts.linkedinUrl,
        twitter_url: contacts.twitterUrl,
        score: contacts.score,
        tags: sql<string>`array_to_string(${contacts.tags}, ';')`,
        notes: contacts.notes,
        created_date: sql<string>`(${contacts.createdAt})::date`
      })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(and(
        eq(contacts.tenantId, tenantId),
        // #2677 — the contacts list hides archived rows (`contacts/route.ts:54`),
        // the bulk routes hide them (`contacts/bulk/route.ts`), and this query
        // did not, so the CSV carried rows the screen never showed.
        eq(contacts.isArchived, false),
        isNull(contacts.deletedAt),
        q ? or(
          ilike(contacts.firstName, `%${escapeLike(q)}%`),
          ilike(contacts.lastName, `%${escapeLike(q)}%`),
          ilike(contacts.email, `%${escapeLike(q)}%`)
        ) : undefined,
        scope
      ))
      // #H2: fetch at most MAX_EXPORT_ROWS + 1 so we can detect (and reject)
      // an over-limit export without loading the whole table into memory.
      .limit(MAX_EXPORT_ROWS + 1);
      break;
    }
      
    case 'deals':
      data = await db.select({
        title: deals.title,
        amount: deals.amount,
        stage_id: deals.stageId,
        contact_name: sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`,
        company_name: companies.name,
        close_date: deals.closeDate,
        created_at: deals.createdAt
      })
      .from(deals)
      .leftJoin(contacts, eq(contacts.id, deals.contactId))
      .leftJoin(companies, eq(companies.id, deals.companyId))
      .where(and(
        eq(deals.tenantId, tenantId),
        isNull(deals.deletedAt),
        // #2677 — `deals/route.ts:53` hides archived deals by default through
        // `archiveFilter`; this branch read them all.
        notArchived(),
        scope
      ))
      .limit(MAX_EXPORT_ROWS + 1);
      break;
      
    case 'tasks':
      data = await db.select({
        title: tasks.title,
        description: tasks.description,
        due_date: tasks.dueDate,
        priority: tasks.priority,
        status: tasks.status,
        related_contact: sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`,
        created_at: tasks.createdAt
      })
      .from(tasks)
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .where(and(
        eq(tasks.tenantId, tenantId),
        isNull(tasks.deletedAt),
        scope
      ))
      .limit(MAX_EXPORT_ROWS + 1);
      break;

    case 'companies':
      data = await db.select({
        name: companies.name,
        domain: companies.domain,
        industry: companies.industry,
        company_size: companies.companySize,
        annual_revenue: companies.annualRevenue,
        city: companies.city,
        country: companies.country,
        website: companies.website,
        created_at: companies.createdAt
      })
      .from(companies)
      .where(and(
        eq(companies.tenantId, tenantId),
        isNull(companies.deletedAt),
        scope
      ))
      .limit(MAX_EXPORT_ROWS + 1);
      break;
      
    case 'leads': {
      const q = filters['q'];
      const leadStatus = filters['lead_status'];
      // #2678 — the columns `app/api/tenant/leads/route.ts:139-165` selects for
      // the list, and the same `q`/`lead_status` predicates it builds at `:93-95`
      // and `:119-128`, so the download matches the rows on screen.
      data = await db.select({
        first_name: leads.firstName,
        last_name: leads.lastName,
        full_name: leads.fullName,
        email: leads.email,
        phone: leads.phone,
        title: leads.title,
        company_name: leads.companyName,
        lead_status: leads.leadStatus,
        lead_source: leads.source,
        score: leads.score,
        value: leads.value,
        lifecycle_stage: leads.lifecycleStage,
        authority_level: leads.authorityLevel,
        city: leads.city,
        country: leads.country,
        tags: sql<string>`array_to_string(${leads.tags}, ';')`,
        created_date: sql<string>`(${leads.createdAt})::date`
      })
      .from(leads)
      .where(and(
        eq(leads.tenantId, tenantId),
        isNull(leads.deletedAt),
        leadStatus ? eq(leads.leadStatus, leadStatus) : undefined,
        q ? or(
          ilike(leads.firstName, `%${escapeLike(q)}%`),
          ilike(leads.lastName, `%${escapeLike(q)}%`),
          ilike(leads.email, `%${escapeLike(q)}%`),
          ilike(leads.phone, `%${escapeLike(q)}%`),
          ilike(leads.companyName, `%${escapeLike(q)}%`)
        ) : undefined,
        scope
      ))
      .limit(MAX_EXPORT_ROWS + 1);
      break;
    }

    default:
      throw new Error(`Unsupported export entity type: ${entityType}`);
  }

  // #H2: if we fetched more than the cap, the export is too large to build
  // safely in memory. Reject rather than risk OOM / pool exhaustion.
  if (data.length > MAX_EXPORT_ROWS) {
    throw new ExportLimitError(MAX_EXPORT_ROWS);
  }

  if (data.length === 0) {
    if (entityType === 'contacts') return 'first_name,last_name,email,phone,company,lead_status,lead_source,city,country,website,linkedin_url,twitter_url,score,tags,notes,created_date';
    if (entityType === 'deals') return 'title,amount,stage_id,contact_name,company_name,close_date,created_at';
    if (entityType === 'tasks') return 'title,description,due_date,priority,status,related_contact,created_at';
    if (entityType === 'companies') return 'name,domain,industry,company_size,annual_revenue,city,country,website,created_at';
    if (entityType === 'leads') return 'first_name,last_name,full_name,email,phone,title,company_name,lead_status,lead_source,score,value,lifecycle_stage,authority_level,city,country,tags,created_date';
    return '';
  }

  if (opts.project) data = await opts.project(data);
  if (data.length === 0) return '';
  // Intersect, not data[0]: projection can remove keys, and every row loses
  // the same fields, but a first-row-only header list would emit undefined
  // cells if projections ever diverge per row.
  let headers = Object.keys(data[0] ?? {});
  for (const row of data) headers = headers.filter((h) => h in row);
  const rows = data.map(row => headers.map(h => row[h] === null ? '' : escapeCSV(row[h])).join(','));
  
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Enqueue a CSV export job
 */
export async function enqueueExport(options: ExportOptions): Promise<void> {
  await addJob('export-csv', {
    type: 'export',
    payload: {
      type: options.entityType,
      filters: options.filters || {},
      callbackUrl: options.callbackUrl,
    },
    tenantId: options.tenantId,
    userId: options.userId,
  }, {
    priority: 5,
    attempts: 3,
  });
}

/**
 * Enqueue a contact import job
 */
export async function enqueueContactImport(
  tenantId: string,
  userId: string,
  csv: string,
  options: { skipDuplicates: boolean; updateExisting: boolean },
  totalRows: number
): Promise<void> {
  if (totalRows > MAX_IMPORT_CONTACTS) {
    throw new ImportLimitError(MAX_IMPORT_CONTACTS, totalRows);
  }

  await addJob('contact-import', {
    type: 'import',
    payload: { csv, options, totalRows },
    tenantId,
    userId,
  }, {
    priority: 3,
    attempts: 1,
  });
}

