/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
  /**
   * Lines that look like an INSERT but that parseInsertStatement could not
   * read. Every caller skips unparseable statements, so a non-zero value here
   * means rows in the backup will NOT be restored — it must never be ignored.
   */
  unparsed_statements: number;
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
 * A single SQL identifier as pg_dump can emit it: either a bare word
 * (`contacts`) or a double-quoted identifier, which may contain a doubled
 * `""` escape (`"Contacts"`, `"odd""name"`).
 *
 * pg_dump emits quoted identifiers whenever a name is mixed-case, reserved or
 * contains punctuation — and always when run with --quote-all-identifiers.
 */
const SQL_IDENTIFIER = String.raw`(?:"(?:[^"]|"")*"|\w+)`;

/**
 * Regex source for an optionally schema-qualified table reference, with the
 * TABLE (not the schema) as its single capture group. Still carries the quotes
 * if the source quoted them — run the capture through `unquoteIdentifier()`.
 *
 * Matches: contacts | public.contacts | "contacts" | "Contacts"
 *        | "public"."contacts" | public."Contacts" | crm.contacts
 *
 * This is the single source of truth for "how do we recognise a table name in
 * an INSERT"; the parser, the verifier and the restore executor all build
 * their regexes from it via `buildInsertIntoRegex()` so it cannot drift again.
 */
export const TABLE_REFERENCE_PATTERN =
  String.raw`(?:${SQL_IDENTIFIER}\s*\.\s*)?(${SQL_IDENTIFIER})`;

/**
 * Build a case-insensitive `INSERT INTO <table-reference>` regex.
 *
 * Capture group 1 is always the (possibly quoted) table name; any capture
 * groups inside `tail` therefore start at 2.
 */
export function buildInsertIntoRegex(
  tail: string,
  options?: { anchored?: boolean }
): RegExp {
  const head = options?.anchored ? String.raw`^\s*` : '';
  return new RegExp(
    `${head}INSERT\\s+INTO\\s+${TABLE_REFERENCE_PATTERN}${tail}`,
    'i'
  );
}

/**
 * Strip the surrounding double quotes from a SQL identifier, collapsing the
 * doubled-quote escape: `"Contacts"` -> `Contacts`, `"a""b"` -> `a"b`.
 * A bare identifier is returned unchanged.
 */
export function unquoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

/** Matches a line that is meant to be an INSERT, whether or not it parses. */
const INSERT_LINE_PATTERN = /^\s*INSERT\s+INTO\s/i;

/**
 * True if the line is an attempted `INSERT INTO ...`. Used to tell "not an
 * INSERT at all" (a comment, a SET, a COPY) apart from "an INSERT we failed to
 * parse" — the latter is data loss and must be reported, not skipped.
 */
export function looksLikeInsertStatement(line: string): boolean {
  return INSERT_LINE_PATTERN.test(line);
}

/** Table name of an INSERT, unquoted and stripped of any schema prefix. */
export function parseTableReference(line: string): string | null {
  const match = line.match(buildInsertIntoRegex(''));
  return match?.[1] ? unquoteIdentifier(match[1]) : null;
}

/**
 * Full shape of a single-line INSERT: table reference, column list, VALUES
 * clause. Group 1 = table, 2 = columns, 3 = everything after VALUES.
 *
 * `VALUES\s*` (not `\s+`) so that `VALUES('c1','Bob')` — emitted by some
 * dump tools and by hand-written fixtures — is accepted. The `VALUES` keyword
 * is anchored to the closing paren of the column list, so a column named
 * `values_count` cannot be mistaken for it.
 */
const INSERT_STATEMENT_TAIL = String.raw`\s*\(([^)]+)\)\s*VALUES\s*(.+);?\s*$`;

/**
 * Extract the raw VALUES clause of an INSERT (all row groups, including the
 * trailing `;` that the greedy capture keeps — downstream group parsing
 * tolerates it).
 */
function extractValuesClause(line: string): string | null {
  const match = line.match(buildInsertIntoRegex(INSERT_STATEMENT_TAIL));
  return match?.[3] ?? null;
}

/** An INSERT decomposed into its table, columns and every VALUES row. */
export interface ParsedInsertRows {
  table: string;
  columns: string[];
  /** One entry per VALUES group, so a multi-row INSERT yields several. */
  rows: string[][];
}

/**
 * Parse an INSERT into its table, columns and ALL of its value rows.
 *
 * This is the single entry point anything needing per-row access should use.
 * `parseInsertStatement` exposes only the first row for backwards
 * compatibility; consumers that reimplemented their own value scanner (the
 * verifier used to) drifted from this one and broke — see the tenant_id
 * extraction defect fixed alongside this.
 */
export function parseInsertRows(line: string): ParsedInsertRows | null {
  const match = line.match(buildInsertIntoRegex(INSERT_STATEMENT_TAIL));
  if (!match?.[1] || !match[2] || !match[3]) return null;

  const columns = parseColumnNames(match[2]);
  const rows = parseValueGroups(match[3]).filter(r => r.length === columns.length);
  if (rows.length === 0) return null;

  return { table: unquoteIdentifier(match[1]), columns, rows };
}

/**
 * Parse a single INSERT statement into structured data.
 * Supports both single-row and multi-row INSERTs:
 *   INSERT INTO t (a, b) VALUES (1, 2);
 *   INSERT INTO t (a, b) VALUES (1, 2), (3, 4), (5, 6);
 * Quoted and schema-qualified table names are accepted; the returned `table`
 * is always unquoted and unqualified (`public."Contacts"` -> `Contacts`).
 */
export function parseInsertStatement(line: string): ParsedStatement | null {
  // Match: INSERT INTO table_name (col1, col2, ...) VALUES (...);
  const match = line.match(buildInsertIntoRegex(INSERT_STATEMENT_TAIL));

  if (!match) return null;

  const table = unquoteIdentifier(match[1]!);
  const columnsStr = match[2]!;
  const valuesStr = match[3]!;
  const columns = parseColumnNames(columnsStr);

  // Parse ALL value groups (supports multi-row INSERTs)
  const allValueGroups = parseValueGroups(valuesStr);
  if (allValueGroups.length === 0) return null;

  // EVERY row must match the column list, not just the first. Checking only
  // row 1 let a malformed later row through, which then failed at execute time
  // and was merely console.error'd — so the restore reported success with a
  // record missing. Rejecting the statement makes it countable as unparsed
  // instead, which is surfaced to the caller.
  if (allValueGroups.some(group => group.length !== columns.length)) return null;

  // For compatibility, return first value group as `values`
  // Multi-row handling is done in the backup file parser
  const values = allValueGroups[0];
  if (!values) return null;

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
  /** Depth of unquoted `(`/`[` nesting, so commas inside them are not splits. */
  let nesting = 0;
  
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

    // Track nesting so a comma *inside* a composite value is not treated as a
    // column separator. Without this, `ARRAY[1,2]`, `ROW(1,2)` and
    // `'{"a":1}'::jsonb` style values split into extra columns, the row's arity
    // stops matching the column list, and the whole row is dropped — silent
    // data loss on restore.
    if (!inQuotes && (char === '(' || char === '[')) {
      nesting++;
      current += char;
      continue;
    }
    if (!inQuotes && (char === ')' || char === ']')) {
      if (nesting > 0) nesting--;
      current += char;
      continue;
    }

    if (char === ',' && !inQuotes && nesting === 0) {
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
  let unparsedStatements = 0;
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
    if (!parsed) {
      // An INSERT we cannot read is a row that will not be restored. Count it
      // so callers can refuse to treat the backup as fully understood.
      if (looksLikeInsertStatement(trimmed)) unparsedStatements++;
      continue;
    }

    statementCount++;
    tablesFound.add(parsed.table);

    // Only process tenant-scoped tables
    if (!TENANT_SCOPED_TABLES.has(parsed.table)) continue;

    // Find tenant_id column index
    const tenantIdIdx = parsed.columns.indexOf('tenant_id');
    if (tenantIdIdx === -1) continue;

    // Parse ALL value groups for multi-row INSERTs
    const valuesClause = extractValuesClause(trimmed);
    if (!valuesClause) continue;
    const allValueGroups = parseValueGroups(valuesClause);

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
    unparsed_statements: unparsedStatements,
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
 * Optionally filters by user_id if provided.
 * Returns array of INSERT statements filtered by tenant_id (and optionally user_id).
 */
export async function extractTenantSQL(
  filePath: string,
  tenantId: string,
  tables: string[],
  userId?: string
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

    // If userId filter is specified, find the user_id column index
    const userIdIdx = userId ? parsed.columns.indexOf('user_id') : -1;

    // Parse all value groups for multi-row support
    const valuesClause = extractValuesClause(trimmed);
    if (!valuesClause) continue;
    const allValueGroups = parseValueGroups(valuesClause);

    // Filter rows matching the target tenant (and optionally user)
    const matchingRows: string[] = [];
    for (const values of allValueGroups) {
      const tenantIdVal = values[tenantIdIdx];
      if (tenantIdVal === undefined) continue;
      const rowTenantId = extractUUIDValue(tenantIdVal);
      if (rowTenantId !== tenantId) continue;

      // If userId filter is active and the table has a user_id column, filter by it
      if (userId && userIdIdx !== -1) {
        const rowUserId = values[userIdIdx];
        if (rowUserId === undefined) continue;
        const extractedUserId = extractUUIDValue(rowUserId);
        if (extractedUserId !== userId) continue;
      }

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
 * Count INSERT lines in a backup that parseInsertStatement cannot read.
 *
 * Optionally restricted to a set of tables. A statement whose table name
 * cannot be determined at all is ALWAYS counted: we cannot prove it is
 * irrelevant to the restore, and under-reporting here is the exact silent
 * data-loss failure mode this counter exists to prevent.
 */
export async function countUnparsedInsertStatements(
  filePath: string,
  tables?: string[]
): Promise<number> {
  let count = 0;
  const stream = getFileStream(filePath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!looksLikeInsertStatement(trimmed)) continue;
    if (parseInsertStatement(trimmed)) continue;

    if (tables && tables.length > 0) {
      const table = parseTableReference(trimmed);
      if (table !== null && !tables.includes(table)) continue;
    }

    count++;
  }

  return count;
}

/**
 * Convert INSERT statement to UPSERT (INSERT ... ON CONFLICT DO UPDATE)
 *
 * Convention: the returned statement never ends with `;`. The ON CONFLICT
 * clause must sit INSIDE the statement, so the trailing semicolon has to go
 * before it is appended; rather than re-adding it on some branches only, every
 * branch returns an unterminated statement. Callers (restore-executor, the
 * upsert path in the API) execute the string as a single statement, where the
 * terminator is optional, so one consistent shape is safer than two.
 */
export function convertToUpsert(statement: string, primaryKey: string = 'id'): string {
  const parsed = parseInsertStatement(statement);
  if (!parsed) return statement;

  const unterminated = statement.replace(/;\s*$/, '');

  const pkIdx = parsed.columns.indexOf(primaryKey);
  if (pkIdx === -1) return `${unterminated} ON CONFLICT DO NOTHING`;

  const nonPkColumns = parsed.columns.filter(c => c !== primaryKey);
  // A PK-only INSERT has nothing to SET; `DO UPDATE SET` with an empty list is
  // a syntax error, so degrade to DO NOTHING (same rule as restore-executor).
  if (nonPkColumns.length === 0) {
    return `${unterminated} ON CONFLICT (${primaryKey}) DO NOTHING`;
  }
  const updateClause = nonPkColumns.map(c => `${c} = EXCLUDED.${c}`).join(', ');

  // Find VALUES position
  const valuesMatch = statement.match(/(VALUES\s*\(.+\))\s*;?\s*$/i);
  if (!valuesMatch) return `${unterminated} ON CONFLICT DO NOTHING`;

  return `${unterminated} ON CONFLICT (${primaryKey}) DO UPDATE SET ${updateClause}`;
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
 
 
  } catch (err: unknown) {
    return {
      valid: false,
      format,
      statement_count: 0,
      error: err instanceof Error ? err.message : 'Failed to read file',
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
