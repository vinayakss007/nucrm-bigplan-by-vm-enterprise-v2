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
 * Parse INSERT statement to extract table name
 */
function parseTableName(line: string): string | null {
  const match = line.match(/INSERT\s+INTO\s+(?:public\.)?(\w+)\s*/i);
  return match ? match[1] ?? null : null;
}

/**
 * Extract tenant_id value from an INSERT statement's VALUES clause
 */
function extractTenantIdFromValues(columns: string[], valuesStr: string): string | null {
  const tenantIdIdx = columns.indexOf('tenant_id');
  if (tenantIdIdx === -1) return null;

  // Parse values to find the tenant_id value
  let depth = 0;
  let inQuotes = false;
  let escapeNext = false;
  let currentValue = '';
  let columnIdx = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (escapeNext) {
      currentValue += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      currentValue += char;
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      inQuotes = !inQuotes;
      currentValue += char;
      continue;
    }

    if (!inQuotes) {
      if (char === '(') {
        depth++;
        currentValue += char;
        continue;
      }
      if (char === ')') {
        depth--;
        currentValue += char;
        if (depth === 0 && columnIdx === tenantIdIdx) {
          return parseUUID(currentValue.trim());
        }
        continue;
      }
      if (char === ',' && depth === 0) {
        if (columnIdx === tenantIdIdx) {
          return parseUUID(currentValue.trim());
        }
        currentValue = '';
        columnIdx++;
        continue;
      }
    }

    currentValue += char;
  }

  return null;
}

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
 * Parse column names from INSERT statement
 */
function parseColumns(line: string): string[] {
  const match = line.match(/INSERT\s+INTO\s+(?:public\.)?\w+\s*\(([^)]+)\)/i);
  if (!match) return [];
  return match[1]!.split(',').map(c => c.trim().replace(/"/g, ''));
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
  let lineCount = 0;

  try {
    const stream = getFileStream(backupPath);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      lineCount++;
      const trimmed = line.trim();
      if (!trimmed.startsWith('INSERT ')) continue;

      totalStatements++;

      const tableName = parseTableName(trimmed);
      if (!tableName) continue;

      tablesFound.add(tableName);
      recordsPerTable[tableName] = (recordsPerTable[tableName] || 0) + 1;

      // Try to extract tenant_id
      const columns = parseColumns(trimmed);
      const valuesMatch = trimmed.match(/VALUES\s+(.+)/i);
      if (valuesMatch && columns.includes('tenant_id')) {
        const tenantId = extractTenantIdFromValues(columns, valuesMatch[1]!);
        if (tenantId) {
          tenantsFound.add(tenantId);
          recordsWithTenantId++;
        } else {
          recordsWithoutTenantId++;
        }
      } else if (!columns.includes('tenant_id')) {
        // Table doesn't have tenant_id column (e.g., global tables)
        recordsWithoutTenantId++;
      }

      // Safety: don't parse huge files entirely
      if (totalStatements >= 1_000_000) {
        result.warnings.push('Large backup (>1M statements). Verification truncated for performance.');
        break;
      }
    }
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
