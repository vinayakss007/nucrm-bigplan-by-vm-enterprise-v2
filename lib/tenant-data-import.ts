/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { sql, type SQL } from 'drizzle-orm';
import { isValidTableName } from '@/lib/sql-allowlist';
import { logger } from '@/lib/logger';
import {
  tenantRestoreLockId,
  TenantRestoreConflictError,
} from '@/lib/tenant-restore-lock';
import { deleteTenantDataInTx } from '@/lib/tenant-restore-wipe';

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

type TenantImportTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class TenantDataImporter {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Import all tables from a backup export
   */
  async importAll(
    tables: Record<string, { columns: string[]; rows: Record<string, unknown>[] }>
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
          } catch (err) {
            result.errors.push({ table: tableName, error: err instanceof Error ? err.message : String(err) });
            logger.error('[Import] Error importing table', { tableName, error: err instanceof Error ? err.message : String(err) });
            // Continue with other tables — don't fail entirely
          }
        }
      });
    } catch (err) {
      throw new Error(`Import transaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return result;
  }

  /**
   * Delete all existing data for this tenant (before restore).
   *
   * Legacy tolerant path (per-table warnings, its own transaction). The
   * restore flow uses `restore()` below, which wipes inside the SAME
   * transaction as the import so a failed import rolls the wipe back (#2225).
   */
  async deleteExistingData(skipTables: string[] = []): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await deleteTenantDataInTx(tx, this.tenantId, { skipTables, failFast: false });
      });
    } catch (err) {
      throw new Error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Atomic wipe + import in ONE transaction (#2225).
   *
   * WHY THIS EXISTS
   * ---------------
   * The old restore path committed the delete in transaction #1 and imported
   * in transaction #2. Any failure between the two (bad row cast, FK order,
   * OOM, process restart) left the tenant's live data deleted with only a
   * partial re-import — the worst possible failure mode for a *recovery*
   * endpoint. Here the wipe and the import share a single transaction: any
   * failure rolls everything back and the tenant's old data stays intact.
   *
   * The first statement takes `pg_try_advisory_xact_lock` on a per-tenant
   * key (the same key the route holds as a session lock for the whole
   * restore), so two restores can never interleave even if both callers pass
   * the route-level check at the same instant. A loser fails fast with
   * `TenantRestoreConflictError` and its (empty) transaction rolls back.
   *
   * Unlike `importAll`, failures are NOT swallowed inside the transaction:
   * Postgres aborts the whole transaction at the first failed statement
   * (25P02), so catching and "continuing" only hides the loss — every later
   * statement would fail anyway and the final COMMIT would silently discard
   * everything. Fail-fast + rollback is the honest behavior.
   */
  async restore(
    tables: Record<string, { columns: string[]; rows: Record<string, unknown>[] }>,
    options: { deleteExisting?: boolean; skipTables?: string[] } = {},
  ): Promise<TenantImportResult> {
    const { deleteExisting = false, skipTables = [] } = options;
    const result: TenantImportResult = {
      tablesRestored: 0,
      recordsRestored: 0,
      errors: [],
    };
    const lockId = tenantRestoreLockId(this.tenantId);

    await db.transaction(async (tx) => {
      const lockRes = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${lockId}) AS acquired`
      ) as unknown as { rows?: { acquired?: boolean }[] };
      if (!lockRes?.rows?.[0]?.acquired) {
        throw new TenantRestoreConflictError(this.tenantId);
      }

      if (deleteExisting) {
        await deleteTenantDataInTx(tx, this.tenantId, { skipTables, failFast: true });
      }

      for (const [tableName, tableData] of Object.entries(tables)) {
        const inserted = await this.importTable(tx, tableName, tableData, { failFast: true });
        result.tablesRestored++;
        result.recordsRestored += inserted;
      }
    });

    return result;
  }

  /**
   * Import a single table
   *
   * `failFast` (used by the atomic restore, #2225) lets every statement error
   * propagate so the surrounding transaction rolls back instead of pressing
   * on in an aborted (25P02) transaction and losing everything at COMMIT.
   */
  private async importTable(
    tx: TenantImportTx,
    tableName: string,
    tableData: { columns: string[]; rows: Record<string, unknown>[] },
    options: { failFast?: boolean } = {},
  ): Promise<number> {
    const failFast = options.failFast === true;
    if (tableData.rows.length === 0) return 0;

    // Table allowlist: only permit known tenant-scoped tables
    if (!isValidTableName(tableName.toLowerCase())) {
      throw new Error(`Table '${tableName}' is not allowed for import`);
    }

    let inserted = 0;

    for (const row of tableData.rows) {
      const columns = Object.keys(row);
      const values = Object.values(row);
      if (columns.length === 0) continue;

      // Determine conflict column — usually 'id'
      const conflictColumn = columns.includes('id') ? 'id' : (columns[0] ?? 'id');

      // Build parameterized INSERT using Drizzle's sql template for safety
      const colList = sql.join(columns.map(c => sql.identifier(c)), sql`, `);
      const placeholders = sql.join(values.map(v => sql`${v}`), sql`, `);

      const query = sql`INSERT INTO ${sql.identifier(tableName)} (${colList}) VALUES (${placeholders}) ON CONFLICT (${sql.identifier(conflictColumn)}) DO NOTHING`;

      const runInsert = async (): Promise<void> => {
        const result = await tx.execute(query) as unknown as { rowCount?: number | null };
        if (result.rowCount && result.rowCount > 0) {
          inserted++;
        }
      };

      if (failFast) {
        await runInsert();
      } else {
        try {
          await runInsert();
        } catch (err) {
          console.warn(`[Import] Row insert failed in ${tableName}:`, err instanceof Error ? err.message : String(err));
        }
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
          } catch (err) {
            result.errors.push({ table: 'sql', error: err instanceof Error ? err.message : String(err) });
            console.warn('[Import SQL] Statement failed:', err instanceof Error ? err.message : String(err));
          }
        }
      });
      result.tablesRestored = 1;
    } catch (err) {
      throw new Error(`SQL import failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return result;
  }
}

function _parseAndBuildInsert(sqlString: string): SQL | null {
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

export function parseSQLValues(valuesStr: string): (string | number | boolean | null)[] {
  const result: (string | number | boolean | null)[] = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const ch = valuesStr[i];
    if (ch === "'") {
      // #1284: SQL standard escapes a quote inside a string by doubling it
      // (''), not with a backslash. When we're inside a quoted value and the
      // next char is also a quote, this is an escaped quote — consume both and
      // stay in-quote so values like 'O''Brien' don't split the string.
      if (inQuote && valuesStr[i + 1] === "'") {
        current += "''";
        i++; // skip the second quote of the pair
      } else {
        inQuote = !inQuote;
        current += ch;
      }
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
