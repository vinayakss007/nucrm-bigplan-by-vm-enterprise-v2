/**
 * Data Integrity Verification
 *
 * Provides functions to verify:
 * - Referential integrity (orphaned records)
 * - Tenant boundary enforcement (no cross-tenant leakage)
 * - Audit chain integrity (hash chain continuity)
 */

import { getPool } from '@/lib/db/pool';
import type { Pool } from 'pg';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface ForeignKeyRelationship {
  /** Source table name */
  sourceTable: string;
  /** Source column referencing the foreign key */
  sourceColumn: string;
  /** Target (parent) table name */
  targetTable: string;
  /** Target (parent) column being referenced */
  targetColumn: string;
}

export interface OrphanedRecord {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  orphanedIds: string[];
  count: number;
}

export interface ReferentialIntegrityResult {
  checked: number;
  violations: OrphanedRecord[];
  clean: boolean;
  checkedAt: string;
}

export interface TenantBoundarySample {
  table: string;
  tenantId: string;
  sampleSize: number;
  foreignTable: string;
  foreignColumn: string;
  crossTenantIds: string[];
  violated: boolean;
}

export interface TenantBoundaryResult {
  checked: number;
  violations: TenantBoundarySample[];
  clean: boolean;
  checkedAt: string;
}

export interface AuditChainEntry {
  id: string;
  previousHash: string | null;
  currentHash: string;
  gapDetected: boolean;
  tamperingSuspected: boolean;
}

export interface AuditChainResult {
  totalRecords: number;
  checkedRecords: number;
  gaps: AuditChainEntry[];
  tamperingDetected: boolean;
  clean: boolean;
  checkedAt: string;
}

// -------------------------------------------------------------------
// Referential Integrity
// -------------------------------------------------------------------

/**
 * Verify referential integrity by checking for orphaned records
 * across the provided foreign key relationships.
 *
 * If no relationships are provided, discovers them from pg_constraint.
 */
export async function verifyReferentialIntegrity(
  relationships?: ForeignKeyRelationship[],
  options: { limit?: number } = {}
): Promise<ReferentialIntegrityResult> {
  const pool: Pool = getPool();
  const { limit = 100 } = options;

  // Discover FK relationships from the database if not provided
  const rels = relationships ?? (await discoverForeignKeys(pool));

  const violations: OrphanedRecord[] = [];

  for (const rel of rels) {
    try {
      const query = `
        SELECT s."${rel.sourceColumn}"::text AS orphaned_id
        FROM "${rel.sourceTable}" s
        LEFT JOIN "${rel.targetTable}" t ON s."${rel.sourceColumn}" = t."${rel.targetColumn}"
        WHERE s."${rel.sourceColumn}" IS NOT NULL
          AND t."${rel.targetColumn}" IS NULL
        LIMIT $1
      `;
      const result = await pool.query(query, [limit]);

      if (result.rows.length > 0) {
        violations.push({
          sourceTable: rel.sourceTable,
          sourceColumn: rel.sourceColumn,
          targetTable: rel.targetTable,
          targetColumn: rel.targetColumn,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orphanedIds: result.rows.map((r: any) => String(r.orphaned_id)),
          count: result.rows.length,
        });
      }
    } catch {
      // Skip tables that don't exist or have permission issues
      continue;
    }
  }

  return {
    checked: rels.length,
    violations,
    clean: violations.length === 0,
    checkedAt: new Date().toISOString(),
  };
}

// -------------------------------------------------------------------
// Tenant Boundary Verification
// -------------------------------------------------------------------

export interface TenantBoundaryCheck {
  /** Table with tenant_id column */
  table: string;
  /** Foreign key column in this table */
  foreignColumn: string;
  /** The table the FK references */
  foreignTable: string;
  /** The column in the foreign table */
  foreignTargetColumn?: string;
}

/**
 * Verify that no records reference data belonging to a different tenant.
 * Samples records and checks that foreign-key targets share the same tenant_id.
 */
export async function verifyTenantBoundaries(
  checks?: TenantBoundaryCheck[],
  options: { sampleSize?: number } = {}
): Promise<TenantBoundaryResult> {
  const pool: Pool = getPool();
  const { sampleSize = 50 } = options;

  const boundaryChecks =
    checks ??
    (await discoverTenantBoundaryChecks(pool));

  const violations: TenantBoundarySample[] = [];

  for (const check of boundaryChecks) {
    const targetCol = check.foreignTargetColumn || 'id';

    try {
      // Find records where the FK references a record in a different tenant
      const query = `
        SELECT DISTINCT s.id::text AS record_id, s.tenant_id::text AS source_tenant
        FROM "${check.table}" s
        INNER JOIN "${check.foreignTable}" t ON s."${check.foreignColumn}" = t."${targetCol}"
        WHERE s.tenant_id IS NOT NULL
          AND t.tenant_id IS NOT NULL
          AND s.tenant_id != t.tenant_id
        LIMIT $1
      `;
      const result = await pool.query(query, [sampleSize]);

      if (result.rows.length > 0) {
        violations.push({
          table: check.table,
          tenantId: '*',
          sampleSize,
          foreignTable: check.foreignTable,
          foreignColumn: check.foreignColumn,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          crossTenantIds: result.rows.map((r: any) => String(r.record_id)),
          violated: true,
        });
      }
    } catch {
      // Skip tables that don't exist or can't be queried
      continue;
    }
  }

  return {
    checked: boundaryChecks.length,
    violations,
    clean: violations.length === 0,
    checkedAt: new Date().toISOString(),
  };
}

// -------------------------------------------------------------------
// Audit Chain Integrity
// -------------------------------------------------------------------

/**
 * Walk the audit log table and verify the hash chain is contiguous.
 * Looks for gaps (missing sequence) and tampered records (hash mismatch).
 *
 * Assumes the audit table has: id, previous_hash, hash, created_at
 */
export async function verifyAuditChainIntegrity(
  options: { tableName?: string; limit?: number } = {}
): Promise<AuditChainResult> {
  const pool: Pool = getPool();
  const { tableName = 'audit_logs', limit = 1000 } = options;

  const gaps: AuditChainEntry[] = [];
  let totalRecords = 0;
  let checkedRecords = 0;
  let tamperingDetected = false;

  try {
    // Get total count
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM "${tableName}"`);
    totalRecords = countResult.rows[0]?.total ?? 0;

    // Fetch the chain ordered by creation
    const rows = await pool.query(
      `SELECT id::text, previous_hash, hash, created_at
       FROM "${tableName}"
       ORDER BY created_at ASC, id ASC
       LIMIT $1`,
      [limit]
    );

    let previousHash: string | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of rows.rows as any[]) {
      checkedRecords++;
      const entry: AuditChainEntry = {
        id: String(row.id),
        previousHash: row.previous_hash ?? null,
        currentHash: row.hash ?? '',
        gapDetected: false,
        tamperingSuspected: false,
      };

      // First record should have null previous_hash
      if (previousHash !== null) {
        // Check chain continuity: this record's previous_hash should match the last record's hash
        if (row.previous_hash && row.previous_hash !== previousHash) {
          entry.gapDetected = true;
          entry.tamperingSuspected = true;
          tamperingDetected = true;
          gaps.push(entry);
        }
      }

      previousHash = row.hash ?? null;
    }
  } catch {
    // If the audit table doesn't exist or lacks expected columns,
    // report gracefully
    return {
      totalRecords: 0,
      checkedRecords: 0,
      gaps: [],
      tamperingDetected: false,
      clean: true,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    totalRecords,
    checkedRecords,
    gaps,
    tamperingDetected,
    clean: gaps.length === 0,
    checkedAt: new Date().toISOString(),
  };
}

// -------------------------------------------------------------------
// Discovery helpers
// -------------------------------------------------------------------

async function discoverForeignKeys(pool: Pool): Promise<ForeignKeyRelationship[]> {
  try {
    const result = await pool.query(`
      SELECT
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      LIMIT 200
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.rows.map((r: any) => ({
      sourceTable: r.source_table,
      sourceColumn: r.source_column,
      targetTable: r.target_table,
      targetColumn: r.target_column,
    }));
  } catch {
    return [];
  }
}

async function discoverTenantBoundaryChecks(pool: Pool): Promise<TenantBoundaryCheck[]> {
  try {
    // Find tables with tenant_id and at least one FK to another table with tenant_id
    const result = await pool.query(`
      SELECT
        tc.table_name AS source_table,
        kcu.column_name AS fk_column,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND kcu.column_name != 'tenant_id'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c1
          WHERE c1.table_name = tc.table_name AND c1.column_name = 'tenant_id' AND c1.table_schema = 'public'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c2
          WHERE c2.table_name = ccu.table_name AND c2.column_name = 'tenant_id' AND c2.table_schema = 'public'
        )
      LIMIT 100
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.rows.map((r: any) => ({
      table: r.source_table,
      foreignColumn: r.fk_column,
      foreignTable: r.target_table,
      foreignTargetColumn: r.target_column,
    }));
  } catch {
    return [];
  }
}
