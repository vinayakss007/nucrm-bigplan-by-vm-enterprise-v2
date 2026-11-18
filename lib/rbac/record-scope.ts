/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 A2 — `record_permissions` was configurable in the admin UI but had
 * zero production readers. Record scoping actually happened through
 * `can(ctx, '<entity>.view_all')` ownership filters, which cannot express
 * "share this one record with finance". This module folds the per-record
 * allow-list into those filters.
 *
 * The existing `lib/rbac/record-permissions.ts:getRecordAccessFilter` builds
 * its WHERE from string column names via `sql.identifier`; that is ambiguous
 * once a list query joins other tables (several entities share
 * `assigned_to`). Here the condition is built from the Drizzle column objects
 * the caller passes, so every reference is qualified by the correct table.
 *
 * Semantics mirror the table: a live, non-tombstoned, unexpired grant at any
 * access level makes the record visible to the role. `none` is not a grant.
 * Superadmins/admins are exempt — a tenant staffing role cannot name them.
 *
 * #3405: every read below goes through the branded `withTenantDb` choke point,
 * so this module is no longer on the raw-client ledger.
 */
import { and, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { withTenantDb } from '@/lib/db';
import { recordPermissions, roles } from '@/drizzle/schema/core';
import type { AuthContext } from '@/lib/auth/middleware';

const roleIdCache = new Map<string, { id: string | null; at: number }>();
const ROLE_TTL_MS = 60_000;

async function resolveRoleId(ctx: AuthContext): Promise<string | null> {
  const { tenantId, roleSlug } = ctx;
  if (!roleSlug) return null;
  const key = `${tenantId}:${roleSlug}`;
  const hit = roleIdCache.get(key);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.id;
  const role = await withTenantDb(tenantId, ctx.userId, async (db) => {
    const [row] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, roleSlug), isNull(roles.deletedAt)))
      .limit(1);
    return row;
  });
  const id = role?.id ?? null;
  roleIdCache.set(key, { id, at: Date.now() });
  return id;
}

/**
 * A SQL condition OR-ing into an ownership filter, or `null` when there is
 * nothing to add (admin/superadmin, unknown role, or no live grants for this
 * role+entity — the common case, so it costs one indexed select).
 *
 * `idColumn` must be the primary-key column of the queried table so the
 * correlation inside EXISTS resolves to that table, not a joined one.
 */
export async function getRecordGrantCondition(
  ctx: AuthContext,
  entityType: string,
  idColumn: AnyPgColumn,
): Promise<SQL | null> {
  if (ctx.isSuperAdmin || ctx.isAdmin) return null;
  const roleId = await resolveRoleId(ctx);
  if (!roleId) return null;

  const grant = await withTenantDb(ctx.tenantId, ctx.userId, async (db) => {
    const [row] = await db
      .select({ id: recordPermissions.id })
      .from(recordPermissions)
      .where(and(
        eq(recordPermissions.tenantId, ctx.tenantId),
        eq(recordPermissions.roleId, roleId),
        eq(recordPermissions.entityType, entityType),
        isNull(recordPermissions.deletedAt),
        or(isNull(recordPermissions.expiresAt), gt(recordPermissions.expiresAt, new Date())),
      ))
      .limit(1);
    return row;
  });
  if (!grant) return null;

  // No `alias()` here: in raw SQL Drizzle renders an alias as just `"rp"`,
  // with no FROM target. The table itself is unambiguous inside a correlated
  // EXISTS, and every inner reference is qualified by its real table name.
  return sql`EXISTS (
    SELECT 1 FROM ${recordPermissions}
    WHERE ${recordPermissions.tenantId} = ${ctx.tenantId}
      AND ${recordPermissions.roleId} = ${roleId}
      AND ${recordPermissions.entityType} = ${entityType}
      AND ${recordPermissions.entityId} = ${idColumn}
      AND ${recordPermissions.deletedAt} IS NULL
      AND (${recordPermissions.expiresAt} IS NULL OR ${recordPermissions.expiresAt} > now())
      AND ${recordPermissions.accessLevel} <> 'none'
  )`;
}

const LEVELS = {
  read: ['read', 'write', 'admin'],
  write: ['write', 'admin'],
  admin: ['admin'],
} as const;

/**
 * Single-record check for detail/mutation handlers that already loaded the row.
 * `required` is the minimum level: read for GET, write for PATCH, admin for
 * DELETE. A `read` grant therefore cannot edit or delete the shared record.
 */
export async function hasRecordGrant(
  ctx: AuthContext,
  entityType: string,
  entityId: string,
  required: keyof typeof LEVELS = 'read',
): Promise<boolean> {
  if (ctx.isSuperAdmin || ctx.isAdmin) return true;
  const roleId = await resolveRoleId(ctx);
  if (!roleId) return false;
  const grant = await withTenantDb(ctx.tenantId, ctx.userId, async (db) => {
    const [row] = await db
      .select({ id: recordPermissions.id })
      .from(recordPermissions)
      .where(and(
        eq(recordPermissions.tenantId, ctx.tenantId),
        eq(recordPermissions.roleId, roleId),
        eq(recordPermissions.entityType, entityType),
        eq(recordPermissions.entityId, entityId),
        isNull(recordPermissions.deletedAt),
        or(isNull(recordPermissions.expiresAt), gt(recordPermissions.expiresAt, new Date())),
        inArray(recordPermissions.accessLevel, [...LEVELS[required]]),
      ))
      .limit(1);
    return row;
  });
  return Boolean(grant);
}
