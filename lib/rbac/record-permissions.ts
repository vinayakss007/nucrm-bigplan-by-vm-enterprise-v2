import { db } from '@/drizzle/db';
import { recordPermissions } from '@/drizzle/schema/core';
import { eq, and, or, sql, isNull, gt } from 'drizzle-orm';

export type RecordAccessLevel = 'none' | 'read' | 'write' | 'admin';

/**
 * Check if a user/role has access to a specific record.
 * Checks both explicit record permissions and ownership (assignedTo/createdBy).
 */
export async function checkRecordAccess(
  tenantId: string,
  userId: string,
  roleId: string,
  entityType: string,
  entityId: string
): Promise<RecordAccessLevel> {
  const now = new Date();

  const results = await db.select()
    .from(recordPermissions)
    .where(and(
      eq(recordPermissions.tenantId, tenantId),
      eq(recordPermissions.roleId, roleId),
      eq(recordPermissions.entityType, entityType),
      eq(recordPermissions.entityId, entityId),
      or(
        isNull(recordPermissions.expiresAt),
        gt(recordPermissions.expiresAt, now)
      )
    ));

  const perm = results[0];
  if (perm) {
    return perm.accessLevel as RecordAccessLevel;
  }

  // No explicit permission - return 'none' (caller may check ownership separately)
  return 'none';
}

/**
 * Grant record-level access to a role
 */
export async function grantRecordAccess(
  tenantId: string,
  roleId: string,
  entityType: string,
  entityId: string,
  accessLevel: RecordAccessLevel,
  grantedBy: string
) {
  // Check for existing grant
  const existing = await db.select()
    .from(recordPermissions)
    .where(and(
      eq(recordPermissions.tenantId, tenantId),
      eq(recordPermissions.roleId, roleId),
      eq(recordPermissions.entityType, entityType),
      eq(recordPermissions.entityId, entityId)
    ));

  if (existing[0]) {
    await db.update(recordPermissions)
      .set({ accessLevel, grantedBy, updatedAt: new Date() })
      .where(eq(recordPermissions.id, existing[0].id));
    return { ...existing[0], accessLevel, grantedBy };
  }

  const [result] = await db.insert(recordPermissions).values({
    tenantId,
    roleId,
    entityType,
    entityId,
    accessLevel,
    grantedBy,
  }).returning();

  return result;
}

/**
 * Revoke record-level access for a role
 */
export async function revokeRecordAccess(
  tenantId: string,
  roleId: string,
  entityType: string,
  entityId: string
) {
  await db.update(recordPermissions)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(recordPermissions.tenantId, tenantId),
      eq(recordPermissions.roleId, roleId),
      eq(recordPermissions.entityType, entityType),
      eq(recordPermissions.entityId, entityId)
    ));
}

/**
 * Entity-to-column mapping for record access filters.
 * Different entities may use different column names for ownership tracking.
 */
export interface EntityColumnMapping {
  /** Column name for the record's primary key (default: 'id') */
  idColumn: string;
  /** Column name for the assigned user (default: 'assigned_to') */
  assignedToColumn: string;
  /** Column name for the record creator (default: 'created_by') */
  createdByColumn: string;
}

const DEFAULT_COLUMN_MAPPING: EntityColumnMapping = {
  idColumn: 'id',
  assignedToColumn: 'assigned_to',
  createdByColumn: 'created_by',
};

/**
 * Entity-specific column mappings for entities with non-standard column names.
 */
const ENTITY_COLUMN_MAPPINGS: Record<string, Partial<EntityColumnMapping>> = {
  contacts: { assignedToColumn: 'assigned_to', createdByColumn: 'created_by' },
  deals: { assignedToColumn: 'assigned_to', createdByColumn: 'created_by' },
  tasks: { assignedToColumn: 'assigned_to', createdByColumn: 'created_by' },
  companies: { assignedToColumn: 'owner_id', createdByColumn: 'created_by' },
  tickets: { assignedToColumn: 'assignee_id', createdByColumn: 'reporter_id' },
  documents: { assignedToColumn: 'owner_id', createdByColumn: 'uploaded_by' },
};

/**
 * Get the column mapping for a given entity type.
 */
export function getColumnMapping(entityType: string): EntityColumnMapping {
  const override = ENTITY_COLUMN_MAPPINGS[entityType];
  if (override) {
    return { ...DEFAULT_COLUMN_MAPPING, ...override };
  }
  return DEFAULT_COLUMN_MAPPING;
}

/**
 * Returns a SQL condition fragment for filtering records by access.
 * Use in WHERE clauses to only show records the user/role can access.
 * 
 * Column names are resolved from the entity-to-column mapping to support
 * entities with different column naming conventions.
 */
export function getRecordAccessFilter(
  tenantId: string,
  userId: string,
  roleId: string,
  entityType: string,
  columnMapping?: Partial<EntityColumnMapping>
) {
  const mapping = { ...getColumnMapping(entityType), ...columnMapping };

  // Returns a SQL expression that can be used in a WHERE clause:
  // Records where:
  //   1. An explicit record permission exists for this role, OR
  //   2. The record is assigned to the user, OR
  //   3. The record was created by the user
  return sql`(
    EXISTS (
      SELECT 1 FROM record_permissions rp
      WHERE rp.tenant_id = ${tenantId}
        AND rp.role_id = ${roleId}
        AND rp.entity_type = ${entityType}
        AND rp.entity_id = ${sql.raw(mapping.idColumn)}
        AND rp.deleted_at IS NULL
        AND (rp.expires_at IS NULL OR rp.expires_at > NOW())
        AND rp.access_level != 'none'
    )
    OR ${sql.raw(mapping.assignedToColumn)} = ${userId}
    OR ${sql.raw(mapping.createdByColumn)} = ${userId}
  )`;
}
