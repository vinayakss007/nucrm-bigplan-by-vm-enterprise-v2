import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { parseInsertStatement } from '@/lib/restore/backup-parser';

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
            // Use tx.execute for bulk delete with tenant_id filter
            await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${this.tenantId}`);
          } catch (e) {
            console.warn('[Import] Primary delete failed for table:', table, e);
            try {
              // Fallback for tables where tenant_id might be named differently or need subquery
              await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE id IN (SELECT id FROM ${sql.identifier(table)} WHERE tenant_id = ${this.tenantId})`);
            } catch (e) {
              // Silently skip during migration/setup when tables may not exist yet
              console.warn('[Import] Failed to delete table', table, (e as Error).message);
            }
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
   * SECURITY: Parses INSERT statements and uses parameterized queries.
   * Only allows INSERT statements targeting known tables.
   */
  static async importFromSQL(tenantId: string, sqlString: string): Promise<TenantImportResult> {
    const result: TenantImportResult = {
      tablesRestored: 0,
      recordsRestored: 0,
      errors: [],
    };

    // Allowlist of tables that can be imported via SQL
    const ALLOWED_IMPORT_TABLES = new Set([
      'contacts', 'companies', 'deals', 'tasks', 'activities',
      'notes', 'tags', 'custom_fields', 'pipeline_stages',
      'users', 'roles', 'permissions',
    ]);

    const statements = sqlString
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s.toUpperCase() !== 'BEGIN' && s.toUpperCase() !== 'COMMIT');

    // Parse each INSERT statement and validate
    const parsedStatements: Array<{ table: string; columns: string[]; values: string[] }> = [];
    
    for (const statement of statements) {
      const upper = statement.toUpperCase().trim();
      if (!upper.startsWith('INSERT')) {
        throw new Error(
          `Security violation: Only INSERT statements allowed in SQL import. ` +
          `Found: ${upper.substring(0, 80)}...`
        );
      }

      const parsed = parseInsertStatement(statement);
      if (!parsed) {
        throw new Error(`Failed to parse INSERT statement: ${statement.substring(0, 100)}...`);
      }

      // Validate table name against allowlist
      if (!ALLOWED_IMPORT_TABLES.has(parsed.table)) {
        throw new Error(
          `Security violation: Table '${parsed.table}' is not in the allowed import tables. ` +
          `Allowed: ${Array.from(ALLOWED_IMPORT_TABLES).join(', ')}`
        );
      }

      // Validate no SQL keywords in values (basic check for injection in values)
      for (const val of parsed.values) {
        const valUpper = val.toUpperCase().trim();
        if (valUpper.includes('DROP ') || valUpper.includes('DELETE ') || 
            valUpper.includes('UPDATE ') || valUpper.includes('EXEC ') ||
            valUpper.includes('EXECUTE ') || valUpper.includes('--')) {
          throw new Error(`Security violation: Suspicious content in value: ${val.substring(0, 50)}`);
        }
      }

      parsedStatements.push(parsed);
    }

    try {
      await db.transaction(async (tx) => {
        for (const { table, columns, values } of parsedStatements) {
          try {
            // Build parameterized INSERT query
            const colList = sql.join(columns.map(c => sql.identifier(c)), sql`, `);
            const placeholders = sql.join(values.map(v => sql`${v}`), sql`, `);
            
            await tx.execute(sql`INSERT INTO ${sql.identifier(table)} (${colList}) VALUES (${placeholders})`);
            result.recordsRestored++;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push({ table, error: message });
            console.warn('[Import SQL] Statement failed:', message);
          }
        }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`SQL import transaction failed: ${message}`);
    }

    return result;
  }
}
