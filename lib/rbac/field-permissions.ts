/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { fieldPermissions } from '@/drizzle/schema/core';
import { eq, and } from 'drizzle-orm';
import { __clearFieldRestrictionsCache } from '@/lib/rbac/enforce';

export type FieldAccessLevel = 'none' | 'read' | 'write' | 'admin';

/**
 * Get all field permissions for a role on an entity type
 */
export async function getFieldPermissions(
  tenantId: string,
  roleId: string,
  entityType: string
) {
  const results = await db.select()
    .from(fieldPermissions)
    .where(and(
      eq(fieldPermissions.tenantId, tenantId),
      eq(fieldPermissions.roleId, roleId),
      eq(fieldPermissions.entityType, entityType)
    ));

  return results;
}

/**
 * Check a specific field's access level for a role
 */
export async function checkFieldAccess(
  tenantId: string,
  roleId: string,
  entityType: string,
  fieldName: string
): Promise<FieldAccessLevel> {
  const results = await db.select()
    .from(fieldPermissions)
    .where(and(
      eq(fieldPermissions.tenantId, tenantId),
      eq(fieldPermissions.roleId, roleId),
      eq(fieldPermissions.entityType, entityType),
      eq(fieldPermissions.fieldName, fieldName)
    ));

  const perm = results[0];
  if (!perm) return 'write'; // Default: full access if no restriction defined
  return perm.accessLevel as FieldAccessLevel;
}

/**
 * Filter fields from a record object based on the role's permissions.
 * Strips fields that don't meet the required access level.
 */
export async function filterFieldsByPermission<T extends Record<string, unknown>>(
  tenantId: string,
  roleId: string,
  entityType: string,
  data: T,
  requiredLevel: 'read' | 'write' = 'read'
): Promise<Partial<T>> {
  const perms = await getFieldPermissions(tenantId, roleId, entityType);

  // Build a map of field -> access level
  const permMap = new Map<string, FieldAccessLevel>();
  for (const p of perms) {
    permMap.set(p.fieldName, p.accessLevel as FieldAccessLevel);
  }

  const accessHierarchy: Record<string, number> = {
    none: 0,
    read: 1,
    write: 2,
    admin: 3,
  };

  const requiredValue = accessHierarchy[requiredLevel] ?? 1;

  const filtered: Partial<T> = {};
  for (const key of Object.keys(data)) {
    const fieldAccess = permMap.get(key);
    // If no permission defined, allow access (default open)
    if (!fieldAccess) {
      (filtered as Record<string, unknown>)[key] = data[key];
      continue;
    }
    const fieldValue = accessHierarchy[fieldAccess] ?? 0;
    if (fieldValue >= requiredValue) {
      (filtered as Record<string, unknown>)[key] = data[key];
    }
  }

  return filtered;
}

/**
 * Set (upsert) a field permission for a role on an entity type
 */
export async function setFieldPermission(
  tenantId: string,
  roleId: string,
  entityType: string,
  fieldName: string,
  accessLevel: FieldAccessLevel
) {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select()
      .from(fieldPermissions)
      .where(and(
        eq(fieldPermissions.tenantId, tenantId),
        eq(fieldPermissions.roleId, roleId),
        eq(fieldPermissions.entityType, entityType),
        eq(fieldPermissions.fieldName, fieldName)
      ))
      .limit(1);

    if (existing) {
      await tx.update(fieldPermissions)
        .set({ accessLevel, updatedAt: new Date() })
        .where(eq(fieldPermissions.id, existing.id));
      return { ...existing, accessLevel };
    }

    const [result] = await tx.insert(fieldPermissions).values({
      tenantId,
      roleId,
      entityType,
      fieldName,
      accessLevel,
    }).returning();

    return result;
  });
  // #2619 — enforcement caches restriction maps for 60 s; this is the only
  // writer, so an admin change must be visible on the next request.
  __clearFieldRestrictionsCache();
  return result;
}
