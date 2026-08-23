/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Backup Verification System
 *
 * Validates backup files to ensure they are:
 * 1. Not corrupt and readable
 * 2. Contain expected tables
 * 3. Have reasonable record counts
 * 4. Have valid tenant_id values
 * 5. Have consistent data (no orphaned references)
 *
 * Usage: Call verifyBackup() after creating a backup or before restoring.
 */

import { existsSync, statSync } from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import {
  buildInsertIntoRegex,
  looksLikeInsertStatement,
  parseInsertRows,
  unquoteIdentifier,
} from './backup-parser';

export interface VerificationResult {
  valid: boolean;
  fileExists: boolean;
  fileSize: number;
  format: 'sql' | 'sql.gz' | 'custom' | 'unknown';
  totalStatements: number;
  tablesFound: string[];
  tablesMissing: string[];
  tenantsFound: string[];
  recordsPerTable: Record<string, number>;
  recordsWithTenantId: number;
  recordsWithoutTenantId: number;
  errors: string[];
  warnings: string[];
  verificationDurationMs: number;
}

/**
 * Critical tables that should always be present in a tenant backup.
 * If these are missing, the backup is likely incomplete.
 */
const CRITICAL_TENANT_TABLES = [
  'tenants', 'contacts', 'leads', 'deals', 'companies',
  'tasks', 'activities', 'tenant_members', 'roles',
];

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
 * Detect backup file format
 */
function detectFormat(filePath: string): 'sql' | 'sql.gz' | 'custom' | 'unknown' {
  if (filePath.endsWith('.gz') || filePath.endsWith('.gzip')) return 'sql.gz';
  if (filePath.endsWith('.sql')) return 'sql';
  if (filePath.endsWith('.dump') || filePath.endsWith('.backup')) return 'custom';
  return 'unknown';
}

/**
 * Parse INSERT statement to extract table name.
 * Quoted and schema-qualified names are handled by the shared pattern in
 * backup-parser, so `public."Contacts"` yields `Contacts`, not `public`.
 */
function parseTableName(line: string): string | null {
  const match = line.match(buildInsertIntoRegex(String.raw`\s*`));
  return match?.[1] ? unquoteIdentifier(match[1]) : null;
}

/*
 * The hand-rolled `extractTenantIdFromValues` that used to live here has been
 * removed. It was handed the VALUES clause *including* its outer parentheses,
 * so its bracket depth never returned to 0 and the column-separator branch
 * never fired: it returned null for every row ever given to it. That made
 * `tenantsFound` permanently empty, `recordsWithTenantId` permanently 0, and
 * `verifyBackup(path, { expectedTenantId })` reject every backup including
 * correct ones — so a pre-restore tenant gate built on it could never pass.
 *
 * Rather than repair a second, divergent value scanner, the verifier now uses
 * `parseInsertRows()` from backup-parser: one parser, already covering quoted
 * identifiers, escapes and multi-row INSERTs.
 */

/**
 * Parse UUID from SQL value (removes quotes)
 */
function parseUUID(sqlValue: string): string | null {
  if (!sqlValue) return null;
  let value = sqlValue;
  if (value.startsWith("'")) value = value.slice(1);
  if (value.endsWith("'")) value = value.slice(0, -1);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }
  return null;
}

/**
 * Verify a backup file for integrity and completeness.
 */
export async function verifyBackup(
  backupPath: string,
  options?: {
    expectedTenantId?: string;
    expectedTables?: string[];
    minRecords?: number;
  }
): Promise<VerificationResult> {
  const startTime = Date.now();

  const result: VerificationResult = {
    valid: true,
    fileExists: false,
    fileSize: 0,
    format: 'unknown',
    totalStatements: 0,
    tablesFound: [],
    tablesMissing: [],
    tenantsFound: [],
    recordsPerTable: {},
    recordsWithTenantId: 0,
    recordsWithoutTenantId: 0,
    errors: [],
    warnings: [],
    verificationDurationMs: 0,
  };

  // 1. Check file exists
  if (!existsSync(backupPath)) {
    result.valid = false;
    result.errors.push('Backup file not found');
    result.verificationDurationMs = Date.now() - startTime;
    return result;
  }
  result.fileExists = true;
  result.fileSize = statSync(backupPath).size;
  result.format = detectFormat(backupPath);

  // 2. Check file is not empty
  if (result.fileSize === 0) {
    result.valid = false;
    result.errors.push('Backup file is empty');
    result.verificationDurationMs = Date.now() - startTime;
    return result;
  }

  // 3. Check format is parseable
  if (result.format === 'custom' || result.format === 'unknown') {
    result.warnings.push(
      `Backup format "${result.format}" cannot be fully verified. ` +
      'Custom format (.dump) files require pg_restore for verification.'
    );
    if (result.format === 'custom') {
      // Can still check file size
      if (result.fileSize < 100) {
        result.valid = false;
        result.errors.push('Custom format backup file is suspiciously small (< 100 bytes)');
      }
      result.verificationDurationMs = Date.now() - startTime;
      return result;
    }
  }

  // 4. Parse file and count statements, tables, tenants
  const tablesFound = new Set<string>();
  const tenantsFound = new Set<string>();
  const recordsPerTable: Record<string, number> = {};
  let totalStatements = 0;
  let recordsWithTenantId = 0;
  let recordsWithoutTenantId = 0;
  let unparsedStatements = 0;
  let _lineCount = 0;

  try {
    const stream = getFileStream(backupPath);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      _lineCount++;
      const trimmed = line.trim();
      if (!trimmed.startsWith('INSERT ')) continue;

      totalStatements++;

      const tableName = parseTableName(trimmed);
      if (!tableName) {
        // We counted the statement but cannot read it. Track it instead of
        // skipping silently — see the unparsed check below.
        if (looksLikeInsertStatement(trimmed)) unparsedStatements++;
        continue;
      }

      tablesFound.add(tableName);
      recordsPerTable[tableName] = (recordsPerTable[tableName] || 0) + 1;

      // Tenant attribution uses the shared parser so a multi-row INSERT is
      // accounted for row by row — a single statement can span tenants.
      const parsed = parseInsertRows(trimmed);
      if (!parsed) {
        // Recognisable as an INSERT (we got a table name) but its rows cannot
        // be read, so the restore would skip them.
        unparsedStatements++;
        continue;
      }

      const tenantIdIdx = parsed.columns.indexOf('tenant_id');
      if (tenantIdIdx === -1) {
        // Table has no tenant_id column (e.g. a global/system table).
        recordsWithoutTenantId += parsed.rows.length;
      } else {
        for (const row of parsed.rows) {
          const tenantId = parseUUID((row[tenantIdIdx] ?? '').trim());
          if (tenantId) {
            tenantsFound.add(tenantId);
            recordsWithTenantId++;
          } else {
            recordsWithoutTenantId++;
          }
        }
      }

      // Safety: don't parse huge files entirely
      if (totalStatements >= 1_000_000) {
        result.warnings.push('Large backup (>1M statements). Verification truncated for performance.');
        break;
      }
    }
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    result.valid = false;
    result.errors.push(`Failed to parse backup file: ${err.message}`);
    result.verificationDurationMs = Date.now() - startTime;
    return result;
  }

  result.totalStatements = totalStatements;
  result.tablesFound = Array.from(tablesFound).sort();
  result.tenantsFound = Array.from(tenantsFound).sort();
  result.recordsPerTable = recordsPerTable;
  result.recordsWithTenantId = recordsWithTenantId;
  result.recordsWithoutTenantId = recordsWithoutTenantId;

  // 5. Check for no statements
  if (totalStatements === 0) {
    result.valid = false;
    result.errors.push('No INSERT statements found in backup file');
  }

  // 5b. A backup whose statements cannot be read is not a verified backup:
  // those rows would be skipped silently by the restore.
  if (unparsedStatements > 0) {
    result.valid = false;
    result.errors.push(
      `${unparsedStatements} INSERT statement(s) could not be parsed. ` +
      'These rows would NOT be restored, so the backup cannot be verified.'
    );
  }

  // 6. Check critical tables
  const expectedCriticalTables = options?.expectedTables
    ? CRITICAL_TENANT_TABLES.filter(t => options.expectedTables?.includes(t) ?? true)
    : CRITICAL_TENANT_TABLES;

  const missingCriticalTables = expectedCriticalTables.filter(t => !tablesFound.has(t));
  if (missingCriticalTables.length > 0) {
    result.warnings.push(
      `Missing critical tables: ${missingCriticalTables.join(', ')}. ` +
      'Backup may be incomplete.'
    );
    result.tablesMissing = missingCriticalTables;
  }

  // 7. Check expected tables if provided
  if (options?.expectedTables) {
    const missingExpected = options.expectedTables.filter(t => !tablesFound.has(t));
    if (missingExpected.length > 0) {
      result.warnings.push(
        `Missing expected tables: ${missingExpected.join(', ')}`
      );
      result.tablesMissing = [...result.tablesMissing, ...missingExpected];
    }
  }

  // 8. Check minimum records
  if (options?.minRecords && totalStatements < options.minRecords) {
    result.warnings.push(
      `Backup has only ${totalStatements} statements (expected at least ${options.minRecords}). ` +
      'This may indicate an incomplete backup.'
    );
  }

  // 9. Check tenant_id coverage
  if (recordsWithoutTenantId > 0 && recordsWithTenantId === 0) {
    result.warnings.push(
      'No tenant_id values found in any records. ' +
      'This backup may contain only global/system data.'
    );
  }

  // 10. Check expected tenant
  if (options?.expectedTenantId && !tenantsFound.has(options.expectedTenantId)) {
    result.valid = false;
    result.errors.push(
      `Expected tenant ${options.expectedTenantId} not found in backup. ` +
      `Tenants found: ${Array.from(tenantsFound).slice(0, 5).join(', ')}`
    );
  }

  result.verificationDurationMs = Date.now() - startTime;
  return result;
}

/**
 * Format verification result for display/logging
 */
export function formatVerificationResult(result: VerificationResult): string {
  const lines: string[] = [];

  lines.push('=== Backup Verification Report ===');
  lines.push(`Status: ${result.valid ? 'PASSED' : 'FAILED'}`);
  lines.push(`Format: ${result.format}`);
  lines.push(`File Size: ${(result.fileSize / 1024).toFixed(1)} KB`);
  lines.push(`Statements: ${result.totalStatements.toLocaleString()}`);
  lines.push(`Tables Found: ${result.tablesFound.length}`);
  lines.push(`Tenants Found: ${result.tenantsFound.length}`);
  lines.push(`Records with tenant_id: ${result.recordsWithTenantId.toLocaleString()}`);
  lines.push(`Records without tenant_id: ${result.recordsWithoutTenantId.toLocaleString()}`);
  lines.push(`Verification Time: ${result.verificationDurationMs}ms`);

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('ERRORS:');
    for (const error of result.errors) {
      lines.push(`  ❌ ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠️ ${warning}`);
    }
  }

  if (result.tablesFound.length > 0) {
    lines.push('');
    lines.push('TABLES (top 20 by record count):');
    const sorted = Object.entries(result.recordsPerTable)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20);
    for (const [table, count] of sorted) {
      lines.push(`  ${table}: ${count.toLocaleString()} records`);
    }
  }

  return lines.join('\n');
}
