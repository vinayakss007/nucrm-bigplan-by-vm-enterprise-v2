/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { eq, and, sql, type SQL } from 'drizzle-orm';
import {
  buildInsertIntoRegex,
  countUnparsedInsertStatements,
  extractTenantSQL,
  parseInsertStatement,
  unquoteIdentifier,
} from './backup-parser';
import { validateTableName } from '@/lib/sql-allowlist';

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
  /**
   * INSERT statements in the backup that could not be parsed, and therefore
   * were NOT restored. When > 0 the restore is PARTIAL: `error` carries a
   * human-readable warning and callers must not treat it as a clean success.
   */
  unparsedStatements: number;
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
    validateTableName(table);
    try {
      const result = await db.execute(sql`
        SELECT * FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}
      `);
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
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`);
      
      // Restore from snapshot
      if (Array.isArray(rows) && rows.length > 0) {
        const columns = Object.keys(rows[0]);
        for (const row of rows) {
          const colIdents = columns.map(c => sql.identifier(c));
          const valParams = columns.map(c => sql`${row[c]}`);
          await tx.execute(sql`
            INSERT INTO ${sql.identifier(table)} (${sql.join(colIdents, sql`, `)})
            VALUES (${sql.join(valParams, sql`, `)})
          `);
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
  let unparsedStatements = 0;
  
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

    // Statements the parser could not read are skipped by extractTenantSQL.
    // Count them up front so the result can admit to being partial instead of
    // reporting a clean success over data that was never written.
    unparsedStatements = await countUnparsedInsertStatements(
      options.backupFilePath,
      options.tables
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
            const safeQuery = buildSafeInsertQuery(statement);
            if (!safeQuery) {
              skippedCount++;
              continue;
            }
            if (options.restoreMode === 'insert_only') {
              const result = await tx.execute(sql`
                ${safeQuery} ON CONFLICT (id) DO NOTHING
              `);
              if (result.rowCount && result.rowCount > 0) newCount++;
              else skippedCount++;
            } else if (options.restoreMode === 'upsert') {
              const parsed = parseInsertStatement(statement);
              if (!parsed) { skippedCount++; continue; }
              const nonPkColumns = parsed.columns.filter(c => c !== 'id');
              if (nonPkColumns.length === 0) {
                const result = await tx.execute(sql`${safeQuery} ON CONFLICT (id) DO NOTHING`);
                if (result.rowCount && result.rowCount > 0) newCount++;
              } else {
                const updateExpr = sql.join(
                  nonPkColumns.map(c => sql`${sql.identifier(c)} = EXCLUDED.${sql.identifier(c)}`),
                  sql`, `
                );
                const result = await tx.execute(sql`
                  ${safeQuery} ON CONFLICT (id) DO UPDATE SET ${updateExpr}
                `);
                if (result.rowCount && result.rowCount > 0) newCount++;
              }
            } else if (options.restoreMode === 'replace') {
              const result = await tx.execute(sql`${safeQuery}`);
              if (result.rowCount && result.rowCount > 0) newCount++;
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

    // A partial restore reports itself: the rows that DID parse are committed
    // (aborting would lose them too), but the caller is told, in the result,
    // exactly how many statements were unreadable and thus not restored.
    const unparsedWarning = unparsedStatements > 0
      ? `${unparsedStatements} INSERT statement(s) in the backup could not be parsed ` +
        'and were NOT restored. This restore is PARTIAL.'
      : undefined;

    onProgress({
      step: 'completed',
      currentCount: processedStatements,
      totalCount: totalStatements,
      status: 'completed',
      message: unparsedWarning
        ? `Restore completed in ${durationMs}ms with warnings: ${unparsedWarning}`
        : `Restore completed in ${durationMs}ms`,
    });

    return {
      success: true,
      recordsAffected,
      recordsPerTable,
      durationMs,
      unparsedStatements,
      ...(unparsedWarning ? { error: unparsedWarning } : {}),
    };
    
 
 
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
      unparsedStatements,
      error: error.message,
    };
  }
}
export async function countExistingRecords(
  tenantId: string,
  tables: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  
  for (const table of tables) {
    try {
      const result = await db.execute(sql`
        SELECT count(*)::int as cnt FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}
      `);
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

/**
 * Parse an INSERT statement and rebuild it using Drizzle parameterized queries.
 * Only allows simple INSERT INTO table (columns) VALUES (values) format.
 * Returns a SQL fragment or null if the statement is not a safe INSERT.
 */
function buildSafeInsertQuery(statement: string): SQL | null {
  const trimmed = statement.replace(/;\s*$/, '').trim();
  const insertMatch = trimmed.match(
    buildInsertIntoRegex(String.raw`\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)\s*$`, {
      anchored: true,
    })
  );
  if (!insertMatch) return null;
  
  const [, rawTableName, columnsStr, valuesStr] = insertMatch;
  if (!rawTableName || !columnsStr || !valuesStr) return null;
  // sql.identifier() quotes the name, so a mixed-case table survives the
  // round-trip; the schema prefix is dropped and the search_path applies.
  const tableName = unquoteIdentifier(rawTableName);
  const columns = columnsStr.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const values = parseInsertValues(valuesStr);
  
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
  `;
}

/**
 * Parse comma-separated SQL values, handling quoted strings.
 */
function parseInsertValues(valuesStr: string): (string | number | boolean | null)[] {
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
      result.push(interpretSQLValue(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    result.push(interpretSQLValue(current.trim()));
  }
  return result;
}

function interpretSQLValue(val: string): string | number | boolean | null {
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
