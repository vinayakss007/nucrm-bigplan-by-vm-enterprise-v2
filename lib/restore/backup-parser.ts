/**
 * Selective Tenant Restore - Backup Parser Utility
 * 
 * Parses .sql and .sql.gz backup files to:
 * 1. Extract INSERT statements
 * 2. Identify tenant_id for each row
 * 3. Group records by tenant and table
 * 4. Generate tenant-specific SQL for selective restore
 */

import { createReadStream, existsSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';
import { createHash } from 'crypto';
import { Readable } from 'stream';

// Tables that have tenant_id column
// Updated: 2026-04-15 — Removed non-tenant tables (users, sessions, refresh_tokens, health_checks)
// Added missing tables from migrations 045, 047, 048, 049
const TENANT_SCOPED_TABLES = new Set([
  // Core CRM tables
  'tenants', 'contacts', 'leads', 'deals', 'tasks', 'companies',
  'activities', 'deal_stages', 'pipelines', 'tags',
  
  // Communication
  'sequences', 'sequence_enrollments', 'sequence_steps', 'sequence_step_logs',
  'email_templates', 'email_tracking', 'email_log',
  'email_warmup_configs', 'email_warmup_pool', 'email_warmup_logs',
  'whatsapp_messages',
  
  // Automation & workflows
  'automations', 'automation_runs', 'automation_workflows',
  'workflows', 'workflow_actions', 'workflow_action_logs', 'workflow_execution_logs',
  
  // AI & analytics
  'ai_insights', 'ai_email_drafts', 'ai_usage_logs',
  'contact_scores', 'churn_predictions', 'deal_forecasts',
  'revenue_projections', 'pipeline_health_metrics',
  
  // Reports & dashboards
  'saved_reports', 'report_executions', 'dashboards',
  
  // Integrations & webhooks
  'webhooks', 'webhook_deliveries', 'webhook_inbound_logs',
  'failed_webhooks', 'api_keys', 'api_key_usage', 'integrations',
  
  // Enterprise features
  'field_permissions', 'record_permissions',
  'products', 'price_books', 'price_book_entries',
  'quotes', 'quote_line_items', 'sso_providers',
  
  // Lead management
  'lead_scoring_rules', 'lead_activities',
  
  // Contact lifecycle & merge
  'contact_lifecycle_history', 'contact_merge_history',
  'contact_emails', 'contact_tags', 'lead_tags',
  
  // Meetings & calls
  'meetings', 'call_recordings', 'call_notes',
  'conversation_metrics', 'conversation_keywords',
  'call_logs',
  
  // Notes & files
  'notes', 'file_uploads', 'file_attachments',
  
  // Forms & modules
  'forms', 'form_submissions',
  'modules', 'tenant_modules',
  
  // Billing & usage
  'billing_events', 'usage_snapshots', 'usage_alerts',
  'limit_violations', 'announcements',
  'custom_field_defs', 'deal_products',
  
  // Tenant settings
  'roles', 'tenant_members', 'invitations',
  'onboarding_progress', 'subscriptions',
  'notifications', 'audit_logs', 'impersonation_sessions',
  
  // Backup/restore tracking (per-tenant data)
  'tenant_backup_records', 'tenant_restore_records',
  'backup_schedules', 'critical_data_backups',
  'selective_restore_logs', 'selective_restore_audit_log',
  'restore_snapshots',
]);

export interface TenantInfo {
  tenant_id: string;
  tenant_name?: string;
  record_counts: Record<string, number>;
  total_records: number;
  tables: string[];
}

export interface BackupMetadata {
  file_size: number;
  file_hash: string;
  statement_count: number;
  tables_found: string[];
  tenants_found: TenantInfo[];
  date_range?: { earliest: string | null; latest: string | null };
  parse_duration_ms: number;
}

export interface ParsedStatement {
  table: string;
  columns: string[];
  values: string[];
  rawStatement: string;
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = filePath.endsWith('.gz')
      ? createReadStream(filePath).pipe(createGunzip())
      : createReadStream(filePath);
    
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Get file stream (handles .gz transparently)
 */
function getFileStream(filePath: string): Readable {
  if (filePath.endsWith('.gz') || filePath.endsWith('.gzip')) {
    return createReadStream(filePath).pipe(createGunzip());
  }
  return createReadStream(filePath);
}

/**
 * Parse a single INSERT statement into structured data.
 * Supports both single-row and multi-row INSERTs:
 *   INSERT INTO t (a, b) VALUES (1, 2);
 *   INSERT INTO t (a, b) VALUES (1, 2), (3, 4), (5, 6);
 */
export function parseInsertStatement(line: string): ParsedStatement | null {
  // Match: INSERT INTO table_name (col1, col2, ...) VALUES (...);
  const match = line.match(
    /INSERT\s+INTO\s+(?:public\.)?(\w+)\s*\(([^)]+)\)\s*VALUES\s+(.+);?\s*$/i
  );

  if (!match) return null;

  const table = match[1]!;
  const columnsStr = match[2]!;
  const valuesStr = match[3]!;
  const columns = parseColumnNames(columnsStr);

  // Parse ALL value groups (supports multi-row INSERTs)
  const allValueGroups = parseValueGroups(valuesStr);
  if (allValueGroups.length === 0) return null;

  // For compatibility, return first value group as `values`
  // Multi-row handling is done in the backup file parser
  const values = allValueGroups[0];
  if (!values) return null;

  if (columns.length !== values.length) return null;

  return { table, columns, values, rawStatement: line };
}

/**
 * Parse multiple value groups from INSERT VALUES clause.
 * Handles: (val1, val2), (val3, val4), (val5, val6)
 * Returns array of value arrays (one per row)
 */
function parseValueGroups(valuesStr: string): string[][] {
  const groups: string[][] = [];
  let currentGroup = '';
  let inQuotes = false;
  let escapeNext = false;
  let depth = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (escapeNext) {
      currentGroup += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      currentGroup += char;
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      inQuotes = !inQuotes;
      currentGroup += char;
      continue;
    }

    if (!inQuotes) {
      if (char === '(') {
        depth++;
        currentGroup += char;
        continue;
      }
      if (char === ')') {
        depth--;
        currentGroup += char;
        // When depth reaches 0, we've completed a value group
        if (depth === 0) {
          const trimmed = currentGroup.trim();
          // Remove outer parentheses and parse values
          const inner = trimmed.slice(1, -1);
          if (inner) {
            groups.push(parseValues(inner));
          }
          currentGroup = '';
        }
        continue;
      }
      if (char === ',' && depth === 0) {
        // Separator between value groups — skip
        continue;
      }
    }

    currentGroup += char;
  }

  // Handle any remaining (single-row case without outer parens in some dumps)
  if (currentGroup.trim() && groups.length === 0) {
    const trimmed = currentGroup.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const inner = trimmed.slice(1, -1);
      groups.push(parseValues(inner));
    }
  }

  return groups;
}

/**
 * Parse column names from "(col1, col2, col3)"
 */
function parseColumnNames(columnsStr: string): string[] {
  return columnsStr.split(',').map(c => c.trim().replace(/"/g, ''));
}

/**
 * Parse SQL values handling quoted strings, NULL, numbers
 */
function parseValues(valuesStr: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let escapeNext = false;
  
  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];
    
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      current += char;
      escapeNext = true;
      continue;
    }
    
    if (char === "'") {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    
    current += char;
  }
  
  if (current.trim()) {
    values.push(current.trim());
  }
  
  return values;
}

/**
 * Extract a string value from SQL format (remove quotes)
 */
function extractStringValue(sqlValue: string): string | null {
  if (!sqlValue || sqlValue === 'NULL' || sqlValue === 'null') return null;
  if (sqlValue.startsWith("'") && sqlValue.endsWith("'")) {
    return sqlValue.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'");
  }
  return null;
}

/**
 * Extract UUID value from SQL format
 */
function extractUUIDValue(sqlValue: string): string | null {
  const str = extractStringValue(sqlValue);
  if (!str) return null;
  // Basic UUID validation
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str;
  }
  return null;
}

/**
 * Extract timestamp value from SQL format
 */
function extractTimestampValue(sqlValue: string): string | null {
  if (!sqlValue || sqlValue === 'NULL' || sqlValue === 'null') return null;
  const str = extractStringValue(sqlValue);
  if (str) return str;
  // Could also be a raw timestamp without quotes in some dumps
  return sqlValue;
}

/**
 * Parse entire backup file and extract tenant information.
 * Supports multi-row INSERTs — each row is counted separately.
 */
export async function parseBackupFile(filePath: string): Promise<BackupMetadata> {
  const startTime = Date.now();

  if (!existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filePath}`);
  }

  const stats = statSync(filePath);
  const fileSize = stats.size;
  const fileHash = await calculateFileHash(filePath);

  const tenantMap = new Map<string, TenantInfo>();
  const tablesFound = new Set<string>();
  let statementCount = 0;
  let earliestDate: string | null = null;
  let latestDate: string | null = null;

  const stream = getFileStream(filePath);
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('INSERT ')) continue;

    const parsed = parseInsertStatement(trimmed);
    if (!parsed) continue;

    statementCount++;
    tablesFound.add(parsed.table);

    // Only process tenant-scoped tables
    if (!TENANT_SCOPED_TABLES.has(parsed.table)) continue;

    // Find tenant_id column index
    const tenantIdIdx = parsed.columns.indexOf('tenant_id');
    if (tenantIdIdx === -1) continue;

    // Parse ALL value groups for multi-row INSERTs
    const valuesStrMatch = trimmed.match(/VALUES\s+(.+);?\s*$/i);
    if (!valuesStrMatch || !valuesStrMatch[1]) continue;
    const allValueGroups = parseValueGroups(valuesStrMatch[1]);

    // Process each row in the multi-row INSERT
    for (const values of allValueGroups) {
      const rawTenantId = values[tenantIdIdx];
      if (rawTenantId === undefined) continue;
      const tenantId = extractUUIDValue(rawTenantId);
      if (!tenantId) continue;

      // Get or create tenant info
      if (!tenantMap.has(tenantId)) {
        tenantMap.set(tenantId, {
          tenant_id: tenantId,
          record_counts: {},
          total_records: 0,
          tables: [],
        });
      }

      const tenant = tenantMap.get(tenantId)!;
      tenant.record_counts[parsed.table] = (tenant.record_counts[parsed.table] || 0) + 1;
      tenant.total_records++;

      if (!tenant.tables.includes(parsed.table)) {
        tenant.tables.push(parsed.table);
      }

      // Try to extract created_at for date range
      const createdAtIdx = parsed.columns.indexOf('created_at');
      if (createdAtIdx !== -1) {
        const rawValue = values[createdAtIdx];
        if (rawValue !== undefined) {
          const dateVal = extractTimestampValue(rawValue);
          if (dateVal) {
            if (!earliestDate || dateVal < earliestDate) earliestDate = dateVal;
            if (!latestDate || dateVal > latestDate) latestDate = dateVal;
          }
        }
      }
    }
  }
  
  // Try to enrich tenant names from users/tenants tables if available
  await enrichTenantNames(filePath, tenantMap);
  
  const parseDuration = Date.now() - startTime;
  
  return {
    file_size: fileSize,
    file_hash: fileHash,
    statement_count: statementCount,
    tables_found: Array.from(tablesFound),
    tenants_found: Array.from(tenantMap.values()),
    date_range: { earliest: earliestDate, latest: latestDate },
    parse_duration_ms: parseDuration,
  };
}

/**
 * Try to find tenant names by parsing tenant/user tables
 */
async function enrichTenantNames(filePath: string, tenantMap: Map<string, TenantInfo>): Promise<void> {
  // Re-parse looking for tenants table to get names
  const stream = getFileStream(filePath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('INSERT ') || !trimmed.includes('tenants')) continue;
    
    const parsed = parseInsertStatement(trimmed);
    if (!parsed) continue;
    
    const idIdx = parsed.columns.indexOf('id');
    const nameIdx = parsed.columns.indexOf('name');
    
    if (idIdx === -1 || nameIdx === -1) continue;
    
    const tenantIdVal = parsed.values[idIdx];
    const nameVal = parsed.values[nameIdx];
    if (tenantIdVal === undefined || nameVal === undefined) continue;

    const tenantId = extractUUIDValue(tenantIdVal);
    const tenantName = extractStringValue(nameVal);

    if (tenantId && tenantName && tenantMap.has(tenantId)) {
      tenantMap.get(tenantId)!.tenant_name = tenantName;
    }
  }
}

/**
 * Extract SQL statements for a specific tenant from backup.
 * Supports multi-row INSERTs — splits them into single-row INSERTs
 * so only matching tenant rows are included.
 * Returns array of INSERT statements filtered by tenant_id.
 */
export async function extractTenantSQL(
  filePath: string,
  tenantId: string,
  tables: string[]
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};

  for (const table of tables) {
    result[table] = [];
  }

  const stream = getFileStream(filePath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('INSERT ')) continue;

    const parsed = parseInsertStatement(trimmed);
    if (!parsed) continue;

    if (!tables.includes(parsed.table)) continue;

    const tenantIdIdx = parsed.columns.indexOf('tenant_id');
    if (tenantIdIdx === -1) continue;

    // Parse all value groups for multi-row support
    const valuesStrMatch = trimmed.match(/VALUES\s+(.+);?\s*$/i);
    if (!valuesStrMatch || !valuesStrMatch[1]) continue;
    const allValueGroups = parseValueGroups(valuesStrMatch[1]);

    // Filter rows matching the target tenant
    const matchingRows: string[] = [];
    for (const values of allValueGroups) {
      const tenantIdVal = values[tenantIdIdx];
      if (tenantIdVal === undefined) continue;
      const rowTenantId = extractUUIDValue(tenantIdVal);
      if (rowTenantId !== tenantId) continue;
      matchingRows.push(`(${values.join(', ')})`);
    }

    // If we have matching rows, generate single-row INSERTs
    if (matchingRows.length > 0 && result[parsed.table]) {
      const columnsStr = parsed.columns.map(c => `"${c}"`).join(', ');
      const tableRef = result[parsed.table]!;
      for (const rowValues of matchingRows) {
        tableRef.push(`INSERT INTO public.${parsed.table} (${columnsStr}) VALUES ${rowValues};`);
      }
    }
  }

  return result;
}

/**
 * Convert INSERT statement to UPSERT (INSERT ... ON CONFLICT DO UPDATE)
 */
export function convertToUpsert(statement: string, primaryKey: string = 'id'): string {
  const parsed = parseInsertStatement(statement);
  if (!parsed) return statement;
  
  const pkIdx = parsed.columns.indexOf(primaryKey);
  if (pkIdx === -1) return statement + ' ON CONFLICT DO NOTHING';
  
  const nonPkColumns = parsed.columns.filter(c => c !== primaryKey);
  const updateClause = nonPkColumns.map(c => `${c} = EXCLUDED.${c}`).join(', ');
  
  // Find VALUES position
  const valuesMatch = statement.match(/(VALUES\s*\(.+\))\s*;?\s*$/i);
  if (!valuesMatch) return statement + ' ON CONFLICT DO NOTHING';
  
  return `${statement.replace(/;\s*$/, '')} ON CONFLICT (${primaryKey}) DO UPDATE SET ${updateClause}`;
}

/**
 * Validate that backup file is readable and contains INSERT statements
 */
export async function validateBackupFile(filePath: string): Promise<{
  valid: boolean;
  format: 'sql' | 'sql.gz' | 'unknown';
  statement_count: number;
  error?: string;
}> {
  if (!existsSync(filePath)) {
    return { valid: false, format: 'unknown', statement_count: 0, error: 'File not found' };
  }
  
  const format = filePath.endsWith('.gz') ? 'sql.gz' : filePath.endsWith('.sql') ? 'sql' : 'unknown';
  
  try {
    let statementCount = 0;
    const stream = getFileStream(filePath);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    
    for await (const line of rl) {
      if (line.trim().startsWith('INSERT ')) {
        statementCount++;
        if (statementCount >= 10) break; // Just check first 10
      }
    }
    
    return {
      valid: statementCount > 0,
      format,
      statement_count: statementCount,
    };
  } catch (err: any) {
    return {
      valid: false,
      format,
      statement_count: 0,
      error: err.message || 'Failed to read file',
    };
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
