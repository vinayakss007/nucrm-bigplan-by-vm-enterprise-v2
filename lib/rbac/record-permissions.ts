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
 * Returns a SQL condition fragment for filtering records by access.
 * Use in WHERE clauses to only show records the user/role can access.
 */
export function getRecordAccessFilter(
  tenantId: string,
  userId: string,
  roleId: string,
  entityType: string
) {
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
        AND rp.entity_id = id
        AND rp.deleted_at IS NULL
        AND (rp.expires_at IS NULL OR rp.expires_at > NOW())
        AND rp.access_level != 'none'
    )
    OR assigned_to = ${userId}
    OR created_by = ${userId}
  )`;
}
