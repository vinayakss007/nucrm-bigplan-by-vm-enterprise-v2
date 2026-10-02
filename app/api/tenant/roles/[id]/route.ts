/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { roles, tenantMembers } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateRoleSchema } from '@/lib/api/schemas';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';
import { invalidateUserContexts } from '@/lib/cache/sessions';
import { logError } from '@/lib/errors-server';

 
 
export const PATCH = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'roles', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;
    const rawBody = await readJsonBody(request);
    const validated = validateBody(updateRoleSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Only the keys the caller actually sent. updateRoleSchema is
    // createRoleSchema.partial(), and in zod v4 partial() keeps a field's
    // default — so a request that never mentioned `permissions` still arrives
    // validated as `{}`. Writing that back would strip every permission from a
    // role someone only meant to rename.
    const sent = rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : {};
    const patch: { name?: string; description?: string | null; permissions?: Record<string, boolean> } = {};
    if ('name' in sent && v.name !== undefined) patch.name = v.name;
    if ('description' in sent) patch.description = v.description || null;
    if ('permissions' in sent) patch.permissions = v.permissions ?? {};
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt =
      typeof sent.expectedUpdatedAt === 'string' || sent.expectedUpdatedAt instanceof Date
        ? sent.expectedUpdatedAt
        : null;
    const guard = await concurrencyGuard(db, roles, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db.update(roles)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId), isNull(roles.deletedAt)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // #661: editing a role's permissions in place must take effect immediately.
    // The auth-context cache stores each member's resolved permissions for up
    // to 5 minutes, so without an explicit bust an admin's permission change
    // would not apply to affected users until that TTL expired. Invalidate the
    // cached context for every active member assigned to this role so their
    // next request re-fetches the new permissions. Best-effort: a cache miss
    // here degrades to the TTL / middleware roleVersion re-check, so never fail
    // the update over it.
    try {
      const members = await db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.roleId, id), eq(tenantMembers.tenantId, ctx.tenantId)));
      await Promise.all(members.map((m) => invalidateUserContexts(m.userId)));
    } catch (e) {
      await logError({ error: e, context: 'tenant/roles/[id] PATCH context invalidation' });
    }

    return NextResponse.json({ data: row });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});

 
 
export const DELETE = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'roles', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const { id } = await params;

    // Cannot delete default system roles
    const [role] = await db
      .select({ slug: roles.slug, isSystem: roles.isSystem })
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId), isNull(roles.deletedAt)))
      .limit(1);

    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // is_system is what provisioning writes (lib/tenants/provision.ts), the slug
    // list is the older guard — either alone misses rows: tenants seeded before
    // the column, and hand-made roles carrying a system slug without the flag.
    if (role.isSystem || ['admin', 'manager', 'sales', 'viewer'].includes(role.slug)) {
      return NextResponse.json({ error: 'Cannot delete system roles' }, { status: 400 });
    }

    const [removed] = await db
      .update(roles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId), isNull(roles.deletedAt)))
      .returning({ id: roles.id });
    if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Same #661 reasoning as the PATCH above, which this route never had: a
    // member's resolved permissions live in the auth-context cache, so deleting
    // their role left them holding that role's grants until the TTL expired.
    try {
      const members = await db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.roleId, id), eq(tenantMembers.tenantId, ctx.tenantId)));
      await Promise.all(members.map((m) => invalidateUserContexts(m.userId)));
    } catch (e) {
      await logError({ error: e, context: 'tenant/roles/[id] DELETE context invalidation' });
    }

    return NextResponse.json({ ok: true });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});
