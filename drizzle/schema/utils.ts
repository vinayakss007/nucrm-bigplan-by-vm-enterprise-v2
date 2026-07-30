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
import { sql } from 'drizzle-orm';

/** Accepts any pgTable result that has an `id` column used for FK references. */
interface FkTableRef {
  id: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Must remain `any` so that `_tenantsRef?.id` satisfies Drizzle's `.references(() => PgColumn)` without an unsafe cast
let _tenantsRef: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Must remain `any` so that `_usersRef?.id` satisfies Drizzle's `.references(() => PgColumn)` without an unsafe cast
let _usersRef: any;

export function _registerFkRefs(tenants: FkTableRef, users: FkTableRef): void {
  _tenantsRef = tenants;
  _usersRef = users;
}

export const pk = () => uuid('id').primaryKey().defaultRandom();

export const tenantId = () => uuid('tenant_id')
  .notNull()
  .references(() => _tenantsRef?.id ?? sql`tenants.id`, { onDelete: 'cascade' });

export const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow();
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

export const metadata = () => jsonb('metadata').default({});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Return type must be `any` so audit() spread is compatible with all pgTable column maps (Drizzle uses complex conditional builder types)
export const createdBy = (): any => uuid('created_by').references(() => _usersRef?.id ?? sql`users.id`, { onDelete: 'set null' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Return type must be `any` so audit() spread is compatible with all pgTable column maps
export const updatedBy = (): any => uuid('updated_by');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Return type must be `any` so audit() spread is compatible with all pgTable column maps
export const deletedBy = (): any => uuid('deleted_by');

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

/** Extract the Drizzle table name from a column's internal symbol metadata. */
const getTableName = (column: { table?: unknown }): string => {
  const table = column.table as Record<symbol, string> | undefined;
  return table?.[Symbol.for('drizzle:Name')] || 'table';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pgTable extra-config callback passes BuildExtraConfigColumns (a complex mapped type); callers cannot satisfy a narrower parameter type without explicit casting
export const tenantIdx = (table: any) => table.tenantId ? index(`idx_${getTableName(table.tenantId)}_tenant`).on(table.tenantId) : undefined as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pgTable extra-config callback passes BuildExtraConfigColumns (a complex mapped type); callers cannot satisfy a narrower parameter type without explicit casting
export const metadataIdx = (table: any) => table.metadata ? index(`idx_${getTableName(table.metadata)}_metadata_g`).using('gin', table.metadata) : undefined as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pgTable extra-config callback passes BuildExtraConfigColumns (a complex mapped type); callers cannot satisfy a narrower parameter type without explicit casting
export const activeIdx = (table: any) => table.id ? index(`idx_${getTableName(table.id)}_active`).on(table.id).where(sql`deleted_at IS NULL`) : undefined as any;
