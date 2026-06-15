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
  text, 
  timestamp, 
  boolean, 
  jsonb,
  index
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tenantsRef: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _usersRef: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _registerFkRefs(tenants: any, users: any) {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createdBy = (): any => uuid('created_by').references(() => _usersRef?.id ?? sql`users.id`, { onDelete: 'set null' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const updatedBy = (): any => uuid('updated_by');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getTableName = (column: any) => column?.table?.[Symbol.for('drizzle:Name')] || 'table';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tenantIdx = (table: any) => table.tenantId ? index(`idx_${getTableName(table.tenantId)}_tenant`).on(table.tenantId) : undefined as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const metadataIdx = (table: any) => table.metadata ? index(`idx_${getTableName(table.metadata)}_metadata_g`).using('gin', table.metadata) : undefined as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const activeIdx = (table: any) => table.id ? index(`idx_${getTableName(table.id)}_active`).on(table.id).where(sql`deleted_at IS NULL`) : undefined as any;
