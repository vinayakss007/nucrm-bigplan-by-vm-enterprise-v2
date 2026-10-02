/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { fieldPermissions, roles } from '@/drizzle/schema';
import { and, asc, eq } from 'drizzle-orm';
import { isUuid } from '@/lib/id';
import { withApiRoute } from '@/lib/api/with-api-route';

const MAX_ROWS = 500;

/**
 * The settings page lists every restriction in one table, so it reads without
 * a role or entity in the URL. `/api/tenant/permissions/fields` is the
 * per-role editor and still requires both.
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const roleId = searchParams.get('role_id');
    const entityType = searchParams.get('entity_type');

    if (roleId && !isUuid(roleId)) {
      return NextResponse.json({ error: 'role_id must be a valid id' }, { status: 400 });
    }

    const rows = await db
      .select({
        id: fieldPermissions.id,
        roleId: fieldPermissions.roleId,
        roleName: roles.name,
        entityType: fieldPermissions.entityType,
        fieldName: fieldPermissions.fieldName,
        access: fieldPermissions.accessLevel,
      })
      .from(fieldPermissions)
      .leftJoin(roles, eq(roles.id, fieldPermissions.roleId))
      .where(and(
        eq(fieldPermissions.tenantId, ctx.tenantId),
        ...(roleId ? [eq(fieldPermissions.roleId, roleId)] : []),
        ...(entityType ? [eq(fieldPermissions.entityType, entityType)] : []),
      ))
      .orderBy(asc(roles.name), asc(fieldPermissions.entityType), asc(fieldPermissions.fieldName))
      .limit(MAX_ROWS);

    return NextResponse.json({ data: rows });
  } catch (err: unknown) { return apiError(err); }
});
