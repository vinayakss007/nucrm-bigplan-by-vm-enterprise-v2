/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { recordPermissions, roles } from '@/drizzle/schema';
import { and, asc, desc, eq } from 'drizzle-orm';
import { isUuid } from '@/lib/id';
import { withApiRoute } from '@/lib/api/with-api-route';

const MAX_ROWS = 500;

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
        id: recordPermissions.id,
        roleId: recordPermissions.roleId,
        roleName: roles.name,
        entityType: recordPermissions.entityType,
        entityId: recordPermissions.entityId,
        accessLevel: recordPermissions.accessLevel,
        expiresAt: recordPermissions.expiresAt,
      })
      .from(recordPermissions)
      .leftJoin(roles, eq(roles.id, recordPermissions.roleId))
      .where(and(
        eq(recordPermissions.tenantId, ctx.tenantId),
        ...(roleId ? [eq(recordPermissions.roleId, roleId)] : []),
        ...(entityType ? [eq(recordPermissions.entityType, entityType)] : []),
      ))
      .orderBy(desc(recordPermissions.createdAt), asc(recordPermissions.entityType))
      .limit(MAX_ROWS);

    return NextResponse.json({ data: rows });
  } catch (err: unknown) { return apiError(err); }
});
