/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Document-level readers over a backup file, split out of
 * lib/restore/backup-parser.ts under #422: what a whole dump contains, which
 * of it is tenant-scoped, and whether the dump could be read at all.
 */

import { existsSync, statSync } from 'fs';
import { createInterface } from 'readline';

import { getFileStream, calculateFileHash } from './file-io';
import { TENANT_SCOPED_TABLES } from './tenant-tables';
import type { BackupMetadata, TenantInfo } from './types';
import {
  extractStringValue,
  extractTimestampValue,
  extractUUIDValue,
  extractValuesClause,
  looksLikeInsertStatement,
  parseInsertStatement,
  parseTableReference,
  parseValueGroups,
} from './sql-grammar';

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
