/**
 * NuCRM - Drizzle Schema Utilities
 * 
 * Industry Best Practices:
 * - Factory functions for consistent column definitions
 * - Standardized naming conventions
 * - Tenant isolation by default
 * - Soft delete support
 * - Audit trail support
 * - Extensibility via metadata
 */

import { 
  uuid, 
  timestamp, 
  jsonb,
  index
} from 'drizzle-orm/pg-core';
import { sql, getTableName as drizzleGetTableName } from 'drizzle-orm';
import type { AnyPgTable, ExtraConfigColumn, IndexBuilder } from 'drizzle-orm/pg-core';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Table } from 'drizzle-orm';

// Internal FK references — lazily populated by _registerFkRefs() at import time.
// These avoid circular imports between core.ts (tenants, users) and utils.ts.
let _tenantsRef: AnyPgTable | undefined;
let _usersRef: AnyPgTable | undefined;

/**
 * Register table references for foreign key columns.
 * Must be called once in core.ts after tenants and users are defined.
 */
export function _registerFkRefs(tenants: AnyPgTable, users: AnyPgTable) {
  _tenantsRef = tenants;
  _usersRef = users;
}

export const pk = () => uuid('id').primaryKey().defaultRandom();

export const tenantId = () => uuid('tenant_id')
  .notNull()
  .references(() => (_tenantsRef as unknown as { id: PgColumn }).id, { onDelete: 'cascade' });

export const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow();
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

export const metadata = () => jsonb('metadata').default({});

export const createdBy = () => uuid('created_by').references(() => (_usersRef as unknown as { id: PgColumn }).id, { onDelete: 'set null' });
export const updatedBy = () => uuid('updated_by');
export const deletedBy = () => uuid('deleted_by');

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Standard lifecycle columns (created, updated, deleted)
 */
export const lifecycle = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

/**
 * Full audit columns (lifecycle + who did it)
 */
export const audit = () => ({
  ...lifecycle(),
  createdBy: createdBy(),
  updatedBy: updatedBy(),
  deletedBy: deletedBy(),
});

// =============================================================================
// INDEX HELPERS
// =============================================================================

/** Extract table name from a column using Drizzle's internal TableName symbol */
function getTableName(column: { table: Table }): string {
  return drizzleGetTableName(column.table);
}

/** 
 * Column map passed by Drizzle's extraConfig callback — maps column names 
 * to ExtraConfigColumn instances. 
 */
type ExtraConfigColumnMap = Record<string, ExtraConfigColumn>;

export const tenantIdx = (table: ExtraConfigColumnMap): IndexBuilder | undefined =>
  table.tenantId ? index(`idx_${getTableName(table.tenantId)}_tenant`).on(table.tenantId) : undefined;

export const metadataIdx = (table: ExtraConfigColumnMap): IndexBuilder | undefined =>
  table.metadata ? index(`idx_${getTableName(table.metadata)}_metadata_g`).using('gin', table.metadata) : undefined;

export const activeIdx = (table: ExtraConfigColumnMap): IndexBuilder | undefined =>
  table.id ? index(`idx_${getTableName(table.id)}_active`).on(table.id).where(sql`deleted_at IS NULL`) : undefined;
