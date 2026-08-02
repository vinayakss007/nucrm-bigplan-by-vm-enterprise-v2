import { db } from '@/drizzle/db';
import { contacts, companies, deals, tasks } from '@/drizzle/schema';
import { eq, and, isNull, ilike, or, sql } from 'drizzle-orm';
import { addJob } from '@/lib/queue';
import { escapeLike } from '@/lib/api/sanitize-like';

export type ExportEntityType = 'contacts' | 'deals' | 'tasks' | 'companies';

export interface ExportOptions {
  tenantId: string;
  userId: string;
  entityType: ExportEntityType;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters?: Record<string, any>;
  callbackUrl?: string;
}

// Maximum contacts per import to prevent system overload
export const MAX_IMPORT_CONTACTS = 1000;

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
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escapes a value for CSV, neutralizing formula injection attacks.
 * Cells starting with formula-triggering characters are prefixed with a single quote.
 * Values that are valid numbers (e.g. -500, +1.5) are exempted from the prefix
 * since they are legitimate numeric data, not formula payloads.
 */
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // Neutralize formula injection by prefixing dangerous characters with a single quote.
  // Skip the prefix if the value is a valid number (e.g. -500, +1.5, -0.3) to avoid
  // mangling legitimate negative amounts, phone numbers like +1-555..., etc.
  if (str.length > 0 && FORMULA_PREFIXES.includes(str[0]!)) {
    const trimmed = str.trim();
    if (!/^[+-]?\d/.test(trimmed)) {
      str = "'" + str;
    }
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
  const { tenantId, entityType, filters = {} } = opts;
  
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] = [];
  
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
        isNull(contacts.deletedAt),
        q ? or(
          ilike(contacts.firstName, `%${escapeLike(q)}%`),
          ilike(contacts.lastName, `%${escapeLike(q)}%`),
          ilike(contacts.email, `%${escapeLike(q)}%`)
        ) : undefined
      ));
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
        isNull(deals.deletedAt)
      ));
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
        isNull(tasks.deletedAt)
      ));
      break;
      
    default:
      throw new Error(`Unsupported export entity type: ${entityType}`);
  }
  
  if (data.length === 0) {
    if (entityType === 'contacts') return 'first_name,last_name,email,phone,company,lead_status,lead_source,city,country,website,linkedin_url,twitter_url,score,tags,notes,created_date';
    if (entityType === 'deals') return 'title,amount,stage_id,contact_name,company_name,close_date,created_at';
    if (entityType === 'tasks') return 'title,description,due_date,priority,status,related_contact,created_at';
    return '';
  }
  
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => (row as Record<string, unknown>)[h] === null ? '' : escapeCSV((row as Record<string, unknown>)[h] as string)).join(','));
  
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

