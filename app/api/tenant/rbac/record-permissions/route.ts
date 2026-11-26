/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { recordPermissions, roles } from '@/drizzle/schema';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { isUuid } from '@/lib/id';
import { withApiRoute } from '@/lib/api/with-api-route';
import { readJsonBody, uuidField, validateBody } from '@/lib/api/validate';
import { grantRecordAccess, revokeRecordAccess } from '@/lib/rbac/record-permissions';

const MAX_ROWS = 500;

/** The entities whose list/detail handlers consult record grants (#2597 A2). */
const ENTITIES = ['deals', 'leads', 'contacts', 'companies', 'tasks', 'tickets', 'documents'] as const;

const grantSchema = z.object({
  role_id: uuidField,
  entity_type: z.enum(ENTITIES),
  entity_id: uuidField,
  access_level: z.enum(['none', 'read', 'write', 'admin']),
  expires_at: z.string().datetime().optional(),
});

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

/**
 * POST — grant a role access to ONE record. The table is keyed by entity_id,
 * so it can express "share this deal with finance", which the `view_all`
 * permission string cannot. It cannot express "all deals owned by a team";
 * the UI copy is corrected separately rather than implying that scope.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const rateLimited = await rateLimitMutating(req, 'rbac', 'post');
    if (rateLimited) return rateLimited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const validated = validateBody(grantSchema, await readJsonBody(req));
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // A role id arriving from the body must belong to the calling tenant;
    // RLS is the backstop, never the primary filter (#2524 family).
    const [role] = await db.select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, v.role_id), eq(roles.tenantId, ctx.tenantId), isNull(roles.deletedAt)))
      .limit(1);
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

    const row = await grantRecordAccess(
      ctx.tenantId,
      v.role_id,
      v.entity_type,
      v.entity_id,
      v.access_level,
      ctx.userId,
    );
    if (!row) return NextResponse.json({ error: 'Could not save the grant' }, { status: 500 });
    // The lib writer does not apply expires_at on update; do it explicitly so
    // a grant can be time-boxed without a second schema change.
    if (v.expires_at) {
      await db.update(recordPermissions)
        .set({ expiresAt: new Date(v.expires_at) })
        .where(and(
          eq(recordPermissions.id, row.id),
          eq(recordPermissions.tenantId, ctx.tenantId),
        ));
    }
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: unknown) { return apiError(err); }
});

/** DELETE ?role_id=&entity_type=&entity_id — tombstone a per-record grant. */
export const DELETE = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const roleId = searchParams.get('role_id');
    const entityType = searchParams.get('entity_type');
    const entityId = searchParams.get('entity_id');
    if (!roleId || !entityId || !entityType || !isUuid(roleId) || !isUuid(entityId)
      || !(ENTITIES as readonly string[]).includes(entityType)) {
      return NextResponse.json(
        { error: 'role_id, entity_id and a supported entity_type are required' },
        { status: 400 },
      );
    }

    await revokeRecordAccess(ctx.tenantId, roleId, entityType, entityId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) { return apiError(err); }
});
