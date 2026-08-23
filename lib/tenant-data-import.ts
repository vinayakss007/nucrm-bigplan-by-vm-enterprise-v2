/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { sql, type SQL } from 'drizzle-orm';
import { isValidTableName } from '@/lib/sql-allowlist';

/**
 * Parameterized junction table deletes.
 * Returns a Drizzle SQL fragment — no raw SQL, no string interpolation.
 */
function junctionDelete(table: string, tenantId: string): SQL {
  switch (table) {
    case 'contact_emails':
      return sql`DELETE FROM contact_emails WHERE contact_id IN (SELECT id FROM contacts WHERE tenant_id = ${tenantId})`;
    case 'contact_tags':
      return sql`DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE tenant_id = ${tenantId})`;
    case 'lead_tags':
      return sql`DELETE FROM lead_tags WHERE lead_id IN (SELECT id FROM leads WHERE tenant_id = ${tenantId})`;
    default:
      throw new Error(`Unknown junction table: ${table}`);
  }
}

/**
 * TenantDataImporter
 * 
 * Imports data for a SINGLE tenant from a backup export.
 * Only affects the target tenant — no other tenant data is touched.
 * 
 * Options:
 *   - deleteExisting: Delete all existing data for this tenant before importing
 *   - skipTables: Tables to skip during import
 *   - upsert: Use INSERT ... ON CONFLICT UPDATE instead of INSERT only
 */

export interface TenantImportResult {
  tablesRestored: number;
  recordsRestored: number;
  errors: { table: string; error: string }[];
}

export class TenantDataImporter {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Import all tables from a backup export
   */
  async importAll(
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    tables: Record<string, { columns: string[]; rows: Record<string, any>[] }>
  ): Promise<TenantImportResult> {
    const result: TenantImportResult = {
      tablesRestored: 0,
      recordsRestored: 0,
      errors: [],
    };

    try {
      await db.transaction(async (tx) => {
        for (const [tableName, tableData] of Object.entries(tables)) {
          try {
            const inserted = await this.importTable(tx, tableName, tableData);
            result.tablesRestored++;
            result.recordsRestored += inserted;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            result.errors.push({ table: tableName, error: err.message });
            console.error(`[Import] Error importing ${tableName}:`, err.message);
            // Continue with other tables — don't fail entirely
          }
        }
      });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      throw new Error(`Import transaction failed: ${err.message}`);
    }

    return result;
  }

  /**
   * Delete all existing data for this tenant (before restore)
   */
  async deleteExistingData(skipTables: string[] = []): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        // Delete in reverse dependency order (children before parents)
        const deleteOrder = [
          'deal_products',
          'quote_line_items',
          'quotes',
          'price_book_entries',
          'price_books',
          'products',
          'workflow_action_logs',
          'workflow_execution_logs',
          'workflow_actions',
          'workflows',
          'automation_runs',
          'automation_workflows',
          'automations',
          'sequence_step_logs',
          'sequence_steps',
          'sequence_enrollments',
          'sequences',
          'whatsapp_messages',
          'email_warmup_logs',
          'email_warmup_pool',
          'email_warmup_configs',
          'call_notes',
          'call_recordings',
          'conversation_keywords',
          'conversation_metrics',
          'churn_predictions',
          'deal_forecasts',
          'revenue_projections',
          'pipeline_health_metrics',
          'ai_usage_logs',
          'contact_scores',
          'ai_email_drafts',
          'ai_insights',
          'report_executions',
          'saved_reports',
          'dashboards',
          'failed_webhooks',
          'webhook_deliveries',
          'webhook_inbound_logs',
          'webhooks',
          'api_key_usage',
          'api_keys',
          'impersonation_sessions',
          'audit_logs',
          'contact_merge_history',
          'contact_lifecycle_history',
          'lead_activities',
          'lead_scoring_rules',
          'sso_providers',
          'integrations',
          'record_permissions',
          'field_permissions',
          'file_uploads',
          'file_attachments',
          'notes',
          'form_submissions',
          'forms',
          'tenant_modules',
          'modules',
          'meetings',
          'email_log',
          'email_tracking',
          'email_templates',
          'contact_emails',
          'contact_tags',
          'lead_tags',
          'billing_events',
          'usage_snapshots',
          'usage_alerts',
          'limit_violations',
          'custom_field_defs',
          'onboarding_progress',
          'subscriptions',
          'invitations',
          'tenant_members',
          'roles',
          'tags',
          'tasks',
          'notifications',
          'activities',
          'deals',
          'deal_stages',
          'pipelines',
          'leads',
          'contacts',
          'companies',
        ];

        for (const table of deleteOrder) {
          if (skipTables.includes(table)) continue;
          try {
            // Junction tables without tenant_id — delete via parent table's tenant_id
            const JUNCTION_TABLES = ['contact_emails', 'contact_tags', 'lead_tags'];
            if (JUNCTION_TABLES.includes(table)) {
              await tx.execute(junctionDelete(table, this.tenantId));
            } else {
              // Standard tables with tenant_id column
              await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${this.tenantId}`);
            }
          } catch (e) {
            console.warn('[Import] Delete failed for table:', table, e);
          }
        }
      });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      throw new Error(`Delete failed: ${err.message}`);
    }
  }

  /**
   * Import a single table
   */
  private async importTable(


// eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    tableName: string,


// eslint-disable-next-line @typescript-eslint/no-explicit-any
    tableData: { columns: string[]; rows: Record<string, any>[] }
  ): Promise<number> {
    if (tableData.rows.length === 0) return 0;

    // Table allowlist: only permit known tenant-scoped tables
    if (!isValidTableName(tableName.toLowerCase())) {
      throw new Error(`Table '${tableName}' is not allowed for import`);
    }

    let inserted = 0;

    for (const row of tableData.rows) {
      const columns = Object.keys(row);
      const values = Object.values(row);

      // Determine conflict column — usually 'id'
      const conflictColumn = columns.includes('id') ? 'id' : (columns[0] ?? 'id');
      if (columns.length === 0) continue;

      // Build parameterized INSERT using Drizzle's sql template for safety
      const colList = sql.join(columns.map(c => sql.identifier(c)), sql`, `);
      const placeholders = sql.join(values.map(v => sql`${v}`), sql`, `);

      const query = sql`INSERT INTO ${sql.identifier(tableName)} (${colList}) VALUES (${placeholders}) ON CONFLICT (${sql.identifier(conflictColumn)}) DO NOTHING`;

      try {
        const result = await tx.execute(query);
        if (result.rowCount && result.rowCount > 0) {
          inserted++;
        }
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.warn(`[Import] Row insert failed in ${tableName}:`, err.message);
      }
    }

    return inserted;
  }

  /**
   * Import from SQL string (alternative format)
   * Only accepts INSERT INTO table (columns) VALUES (values) statements.
   * All statements are parsed, validated against an allowlist, and
   * rebuilt using parameterized queries to prevent SQL injection.
   */
  static async importFromSQL(tenantId: string, sqlString: string): Promise<TenantImportResult> {
    const result: TenantImportResult = {
      tablesRestored: 0,
      recordsRestored: 0,
      errors: [],
    };

    try {
      await db.transaction(async (tx) => {
        const rawStatements = sqlString
          .split(';')
          .map(s => s.trim())
          .filter(s => s && !/^--/.test(s) && !/^(BEGIN|COMMIT|START|END)/i.test(s));

        for (const statement of rawStatements) {
          try {
            // Only allow INSERT statements — UPDATE/DELETE are rejected to prevent
            // untrusted raw SQL execution (SQL injection via sql.raw())
            if (!/^\s*INSERT\s+INTO\b/i.test(statement)) {
              result.errors.push({ table: 'sql', error: `Non-INSERT statement rejected (only INSERT allowed): ${statement.substring(0, 80)}...` });
              continue;
            }

            // Parse the INSERT into a parameterized query
            const safeQuery = _parseAndBuildInsert(statement);
            if (!safeQuery) {
              result.errors.push({ table: 'sql', error: `Could not parse INSERT statement: ${statement.substring(0, 80)}...` });
              continue;
            }

            const res = await tx.execute(safeQuery);
            if (res.rowCount) {
              result.recordsRestored += res.rowCount;
            }
 


// eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            result.errors.push({ table: 'sql', error: err.message });
            console.warn('[Import SQL] Statement failed:', err.message);
          }
        }
      });
      result.tablesRestored = 1;
 


// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      throw new Error(`SQL import failed: ${err.message}`);
    }

    return result;
  }
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _parseAndBuildInsert(sqlString: string): any {
  // Accept an optional schema qualifier and optional double-quoted identifiers,
  // e.g. all of:
  //     INSERT INTO contacts (...)
  //     INSERT INTO public.contacts (...)
  //     INSERT INTO "contacts" (...)
  //     INSERT INTO "public"."contacts" (...)
  // pg_dump quotes identifiers whenever they are mixed-case or reserved, so a
  // parser that only accepted bare names rejected every statement in such a
  // dump — producing a "successful" restore with zero rows.
  // The captured name is still checked against the table allowlist below, so
  // permitting quotes does not widen what can be written to.
  const match = sqlString.trim().match(
    /^\s*INSERT\s+INTO\s+(?:"?public"?\.)?"?(\w+)"?\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)\s*$/i
  );
  if (!match) return null;

  const [, tableName, columnsStr, valuesStr] = match;
  if (!tableName || !columnsStr || !valuesStr) return null;
  if (!isValidTableName(tableName.toLowerCase())) return null;

  const columns = columnsStr.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const values = parseSQLValues(valuesStr);

  if (columns.length !== values.length || columns.length === 0) return null;

  const colIdents = columns.map(c => sql.identifier(c));
  const valParams = values.map(v => {
    if (v === null) return sql`DEFAULT`;
    if (typeof v === 'number') return sql`${v}`;
    return sql`${v}`;
  });

  return sql`
    INSERT INTO ${sql.identifier(tableName)} (${sql.join(colIdents, sql`, `)})
    VALUES (${sql.join(valParams, sql`, `)})
    ON CONFLICT DO NOTHING
  `;
}

function parseSQLValues(valuesStr: string): (string | number | boolean | null)[] {
  const result: (string | number | boolean | null)[] = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const ch = valuesStr[i];
    if (ch === "'" && (i === 0 || valuesStr[i - 1] !== '\\')) {
      inQuote = !inQuote;
      current += ch;
    } else if (!inQuote && ch === '(') {
      parenDepth++;
      current += ch;
    } else if (!inQuote && ch === ')') {
      parenDepth--;
      current += ch;
    } else if (!inQuote && ch === ',' && parenDepth === 0) {
      result.push(interpretLiteral(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    result.push(interpretLiteral(current.trim()));
  }
  return result;
}

function interpretLiteral(val: string): string | number | boolean | null {
  if (/^NULL$/i.test(val)) return null;
  if (/^TRUE$/i.test(val)) return true;
  if (/^FALSE$/i.test(val)) return false;
  if (/^\d+$/.test(val)) {
    const n = parseInt(val, 10);
    // BigInt overflow guard: if integer exceeds safe range, keep as string
    if (!Number.isSafeInteger(n)) return val;
    return n;
  }
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.slice(1, -1).replace(/''/g, "'");
  }
  return val;
}
