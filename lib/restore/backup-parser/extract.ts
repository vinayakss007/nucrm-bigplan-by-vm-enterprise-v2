/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Producing the statements a restore will actually run, split out of
 * lib/restore/backup-parser.ts under #422: per-tenant extraction, the UPSERT
 * rewrite, and the display helper the backups listing uses.
 */

import { createInterface } from 'readline';

import { getFileStream } from './file-io';
import {
  extractUUIDValue,
  extractValuesClause,
  parseInsertStatement,
  parseValueGroups,
} from './sql-grammar';

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
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
