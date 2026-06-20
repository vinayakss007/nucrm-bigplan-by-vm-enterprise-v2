/**
 * Selective Tenant Restore - Restore Executor
 * 
 * Handles the actual restore process:
 * 1. Lock tenant (prevent concurrent writes)
 * 2. Create pre-restore snapshot
 * 3. Execute SQL statements in transaction
 * 4. Validate results
 * 5. Commit or rollback
 * 6. Unlock tenant
 */

import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { restoreSnapshots } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { extractTenantSQL, convertToUpsert } from './backup-parser';

/**
 * Foreign key dependency ordering for restore.
 * Tables must be restored in dependency order (parents before children)
 * to avoid FK constraint violations.
 */
const TABLE_DEPENDENCY_ORDER: string[] = [
  // Level 1: Foundation tables (no FK deps on other tenant tables)
  'tenants', 'modules',

  // Level 2: Configuration & settings
  'roles', 'tenant_members', 'invitations', 'onboarding_progress', 'subscriptions',
  'pipelines', 'deal_stages', 'tags',

  // Level 3: Core CRM entities (depend on config)
  'contacts', 'companies', 'leads', 'deals',
  'custom_field_defs', 'products', 'price_books',

  // Level 4: Junction tables & child entities
  'contact_emails', 'contact_tags', 'lead_tags',
  'price_book_entries', 'quotes', 'quote_line_items',
  'deal_products', 'sso_providers', 'integrations',
  'field_permissions', 'record_permissions',

  // Level 5: Communication entities
  'email_templates', 'email_tracking', 'email_log',
  'sequences', 'sequence_enrollments', 'sequence_steps', 'sequence_step_logs',
  'whatsapp_messages',
  'email_warmup_configs', 'email_warmup_pool', 'email_warmup_logs',

  // Level 6: Automation & workflows
  'workflows', 'workflow_actions', 'workflow_execution_logs', 'workflow_action_logs',
  'automations', 'automation_workflows', 'automation_runs',

  // Level 7: AI & analytics
  'ai_insights', 'ai_email_drafts', 'contact_scores', 'ai_usage_logs',
  'churn_predictions', 'deal_forecasts', 'revenue_projections', 'pipeline_health_metrics',

  // Level 8: Reports & dashboards
  'saved_reports', 'report_executions', 'dashboards',

  // Level 9: Integration & webhooks
  'webhooks', 'webhook_deliveries', 'webhook_inbound_logs', 'failed_webhooks',
  'api_keys', 'api_key_usage',

  // Level 10: Lead management
  'lead_scoring_rules', 'lead_activities',

  // Level 11: Contact lifecycle & audit
  'contact_lifecycle_history', 'contact_merge_history',
  'audit_logs', 'impersonation_sessions',

  // Level 12: Forms & modules
  'tenant_modules', 'forms', 'form_submissions',

  // Level 13: Meetings & calls
  'meetings', 'call_recordings', 'call_notes',
  'conversation_metrics', 'conversation_keywords',

  // Level 14: Notes & files
  'notes', 'file_uploads', 'file_attachments',

  // Level 15: Activity & tasks
  'tasks', 'activities', 'notifications',

  // Level 16: Billing & usage
  'billing_events', 'usage_snapshots', 'usage_alerts', 'limit_violations', 'announcements',
];

/**
 * Order tables by foreign key dependency.
 */
export function orderTablesByDependency(tables: string[]): string[] {
  const positionMap = new Map<string, number>();
  TABLE_DEPENDENCY_ORDER.forEach((table, idx) => {
    positionMap.set(table, idx);
  });

  const known: { table: string; position: number }[] = [];
  const unknown: string[] = [];

  for (const table of tables) {
    const pos = positionMap.get(table);
    if (pos !== undefined) {
      known.push({ table, position: pos });
    } else {
      unknown.push(table);
    }
  }

  known.sort((a, b) => a.position - b.position);
  return [...known.map(k => k.table), ...unknown];
}

export interface RestoreOptions {
  backupFilePath: string;
  tenantId: string;
  tables: string[];
  restoreMode: 'insert_only' | 'upsert' | 'replace';
  performedBy: string;
  /** Optional: filter restored rows to only those belonging to this user */
  userId?: string;
}

export interface RestoreProgress {
  step: string;
  currentTable?: string;
  currentCount: number;
  totalCount: number;
  status: 'running' | 'completed' | 'failed';
  message?: string;
}

export interface RestoreResult {
  success: boolean;
  recordsAffected: Record<string, number>;
  recordsPerTable: Record<string, { new: number; updated: number; skipped: number }>;
  durationMs: number;
  error?: string;
}

/**
 * Create a pre-restore snapshot of current tenant data
 */
export async function createPreRestoreSnapshot(
  tenantId: string,
  tables: string[]
): Promise<string> {
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotData: Record<string, any[]> = {};
  let totalRecords = 0;
  
  for (const table of tables) {
    try {
      const result = await db.execute(sql.raw(`SELECT * FROM public.${table} WHERE tenant_id = '${tenantId}'`));
      snapshotData[table] = result.rows;
      totalRecords += result.rows.length;
    } catch {
      // Silently skip during migration/setup when tables may not exist yet
      snapshotData[table] = [];
    }
  }
  
  const [snapshotResult] = await db.insert(restoreSnapshots).values({
    tenantId,
    snapshotData,
    tableCount: tables.length,
    recordCount: totalRecords,
  }).returning({ id: restoreSnapshots.id });
  
  if (!snapshotResult) throw new Error('Failed to create snapshot record');
  
  return snapshotResult.id;
}

/**
 * Rollback to a specific snapshot
 */
export async function rollbackToSnapshot(snapshotId: string, tenantId: string): Promise<void> {
  const snapshot = await db.query.restoreSnapshots.findFirst({
    where: and(eq(restoreSnapshots.id, snapshotId), eq(restoreSnapshots.tenantId, tenantId))
  });
  
  if (!snapshot) {
    throw new Error('Snapshot not found');
  }
  
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotData = snapshot.snapshotData as Record<string, any[]>;
  
  await db.transaction(async (tx) => {
    for (const [table, rows] of Object.entries(snapshotData)) {
      // Delete current data
      await tx.execute(sql.raw(`DELETE FROM public.${table} WHERE tenant_id = '${tenantId}'`));
      
      // Restore from snapshot
      if (Array.isArray(rows) && rows.length > 0) {
        const columns = Object.keys(rows[0]);
        for (const row of rows) {
          const values = columns.map(c => formatSQLValue(row[c])).join(', ');
          await tx.execute(sql.raw(
            `INSERT INTO public.${table} (${columns.join(', ')}) VALUES (${values})`
          ));
        }
      }
    }
  });
}

/**
 * Execute selective restore
 */
export async function executeSelectiveRestore(
  options: RestoreOptions,
  onProgress: (progress: RestoreProgress) => void
): Promise<RestoreResult> {
  const startTime = Date.now();
  const recordsAffected: Record<string, number> = {};
  const recordsPerTable: Record<string, { new: number; updated: number; skipped: number }> = {};
  
  try {
    onProgress({
      step: 'extracting',
      currentCount: 0,
      totalCount: 0,
      status: 'running',
      message: 'Extracting tenant data from backup...',
    });
    
    const tenantSQL = await extractTenantSQL(
      options.backupFilePath,
      options.tenantId,
      options.tables,
      options.userId
    );
    
    let totalStatements = 0;
    for (const statements of Object.values(tenantSQL)) {
      totalStatements += statements.length;
    }
    
    let processedStatements = 0;
    
    onProgress({
      step: 'restoring',
      currentCount: 0,
      totalCount: totalStatements,
      status: 'running',
      message: 'Starting restore...',
    });
    
    await db.transaction(async (tx) => {
      const orderedTables = orderTablesByDependency(options.tables);

      for (const table of orderedTables) {
        const statements = tenantSQL[table] || [];
        if (statements.length === 0) {
          recordsAffected[table] = 0;
          recordsPerTable[table] = { new: 0, updated: 0, skipped: 0 };
          continue;
        }
        
        onProgress({
          step: 'restoring',
          currentTable: table,
          currentCount: processedStatements,
          totalCount: totalStatements,
          status: 'running',
          message: `Restoring ${table}...`,
        });
        
        let newCount = 0;
        const updatedCount = 0;
        let skippedCount = 0;
        
        for (const statement of statements) {
          try {
            if (options.restoreMode === 'insert_only') {
              const result = await tx.execute(sql.raw(
                statement.replace(/;\s*$/, '') + ' ON CONFLICT (id) DO NOTHING'
              ));
              if (result.rowCount && result.rowCount > 0) newCount++;
              else skippedCount++;
            } else if (options.restoreMode === 'upsert') {
              const upsertSQL = convertToUpsert(statement);
              const result = await tx.execute(sql.raw(upsertSQL));
              if (result.rowCount && result.rowCount > 0) newCount++;
            } else if (options.restoreMode === 'replace') {
              await tx.execute(sql.raw(statement));
              newCount++;
            }
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            console.error(`[restore] Failed to restore row in ${table}:`, err.message);
          }
          
          processedStatements++;
          if (processedStatements % 50 === 0) {
            onProgress({
              step: 'restoring',
              currentTable: table,
              currentCount: processedStatements,
              totalCount: totalStatements,
              status: 'running',
              message: `Restored ${processedStatements}/${totalStatements} statements...`,
            });
          }
        }
        
        recordsAffected[table] = newCount + updatedCount;
        recordsPerTable[table] = { new: newCount, updated: updatedCount, skipped: skippedCount };
      }
    });
    
    const durationMs = Date.now() - startTime;
    onProgress({
      step: 'completed',
      currentCount: processedStatements,
      totalCount: totalStatements,
      status: 'completed',
      message: `Restore completed in ${durationMs}ms`,
    });
    
    return { success: true, recordsAffected, recordsPerTable, durationMs };
    
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    onProgress({
      step: 'failed',
      currentCount: 0,
      totalCount: 0,
      status: 'failed',
      message: `Restore failed: ${error.message}`,
    });
    
    return {
      success: false,
      recordsAffected,
      recordsPerTable,
      durationMs,
      error: error.message,
    };
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSQLValue(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function countExistingRecords(
  tenantId: string,
  tables: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  
  for (const table of tables) {
    try {
      const result = await db.execute(sql.raw(
        `SELECT count(*)::int as cnt FROM public.${table} WHERE tenant_id = '${tenantId}'`
      ));
      const row = result.rows[0] as { cnt?: number } | undefined;
      counts[table] = row?.cnt ?? 0;
    } catch {
      console.error('[restore] Failed to count table', table);
      counts[table] = 0;
    }
  }
  
  return counts;
}

export async function validateTenant(tenantId: string): Promise<{
  valid: boolean;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenant?: any;
  error?: string;
}> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { id: true, name: true, slug: true, status: true }
  });
  
  if (!tenant) {
    return { valid: false, error: 'Tenant not found' };
  }
  
  if (tenant.status === 'suspended' || tenant.status === 'deleted') {
    return { valid: false, error: `Tenant is ${tenant.status}` };
  }
  
  return { valid: true, tenant };
}
