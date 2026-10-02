/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateRoleSchema } from '@/lib/api/schemas';
import { roles, tenantMembers } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';
import { withTenantContext } from '@/lib/db/rls';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { invalidateUserContexts } from '@/lib/cache/sessions';
import { isUuid } from '@/lib/id';

/**
 * Edit or retire one role of the tenant named in the path.
 *
 * Same target-tenant reasoning as ./route.ts: `roles` isolates on
 * app.current_tenant with no super-admin branch, so the transaction has to carry
 * the TARGET tenant's context, not the console account's.
 */

type Guarded = { kind: 'response'; res: NextResponse };

function notGuarded(outcome: object): outcome is Guarded {
  return 'response' in outcome;
}

export const PATCH = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string; roleId: string }> }) => {
  try {
    const limited = await rateLimitMutating(request, 'superadmin-roles', 'patch');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId, roleId } = await params;
    if (!isUuid(tenantId) || !isUuid(roleId)) {
      return NextResponse.json({ error: 'Invalid tenant or role id' }, { status: 400 });
    }

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

    const expectedUpdatedAt =
      typeof sent.expectedUpdatedAt === 'string' || sent.expectedUpdatedAt instanceof Date
        ? sent.expectedUpdatedAt
        : null;

    const result = await withTenantContext<{ kind: 'response'; res: NextResponse } | { kind: 'row'; row: typeof roles.$inferSelect } | { kind: 'notFound' }>(
      tenantId, ctx.userId, async (tx) => {
        const guard = await concurrencyGuard(tx, roles, roleId, tenantId, expectedUpdatedAt);
        if (guard) return { kind: 'response' as const, res: guard };

        const [row] = await tx.update(roles)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
          .returning();
        if (!row) return { kind: 'notFound' as const };

        // #661, applied to the console: members of this tenant hold their resolved
        // permissions in the auth-context cache, so an edit made here would not
        // reach them until the TTL expired. Best-effort — a cache miss degrades to
        // the middleware's roleVersion re-check, so never fail the write over it.
        try {
          const members = await tx
            .select({ userId: tenantMembers.userId })
            .from(tenantMembers)
            .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.roleId, roleId)));
          await Promise.all(members.map((m) => invalidateUserContexts(m.userId)));
        } catch (e) {
          await logError({ error: e, context: 'superadmin/tenants/[id]/roles/[roleId] PATCH context invalidation' });
        }

        return { kind: 'row' as const, row };
      }
    );

    if (notGuarded(result)) return result.res;
    if (result.kind === 'notFound') return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || '',
      action: 'role.updated',
      targetType: 'tenant',
      targetId: tenantId,
      metadata: { role_id: roleId, fields: Object.keys(patch) },
    });

    return NextResponse.json({ data: result.row });
  } catch (err) {
    await logError({ error: err, context: 'superadmin/tenants/[id]/roles/[roleId] PATCH', requestMethod: 'PATCH' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string; roleId: string }> }) => {
  try {
    const limited = await rateLimitMutating(request, 'superadmin-roles', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId, roleId } = await params;
    if (!isUuid(tenantId) || !isUuid(roleId)) {
      return NextResponse.json({ error: 'Invalid tenant or role id' }, { status: 400 });
    }

    const result = await withTenantContext<
      { kind: 'response'; res: NextResponse } | { kind: 'ok' } | { kind: 'notFound' } | { kind: 'system'; slug: string }
    >(tenantId, ctx.userId, async (tx) => {
      const [role] = await tx
        .select({ slug: roles.slug, isSystem: roles.isSystem })
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
        .limit(1);
      if (!role) return { kind: 'notFound' as const };
      // is_system is what provisioning writes (lib/tenants/provision.ts), the slug
      // list is what the tenant-facing route checks — either alone misses rows:
      // older tenants were seeded before the column, and hand-made roles can carry
      // a system slug without the flag.
      if (role.isSystem || ['admin', 'manager', 'sales', 'viewer'].includes(role.slug)) {
        return { kind: 'system' as const, slug: role.slug };
      }

      const [updated] = await tx
        .update(roles)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
        .returning({ id: roles.id });
      if (!updated) return { kind: 'notFound' as const };

      try {
        const members = await tx
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.roleId, roleId)));
        await Promise.all(members.map((m) => invalidateUserContexts(m.userId)));
      } catch (e) {
        await logError({ error: e, context: 'superadmin/tenants/[id]/roles/[roleId] DELETE context invalidation' });
      }

      return { kind: 'ok' as const };
    });

    if (notGuarded(result)) return result.res;
    if (result.kind === 'notFound') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (result.kind === 'system') {
      return NextResponse.json({ error: 'Cannot delete system roles' }, { status: 400 });
    }

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || '',
      action: 'role.deleted',
      targetType: 'tenant',
      targetId: tenantId,
      metadata: { role_id: roleId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    await logError({ error: err, context: 'superadmin/tenants/[id]/roles/[roleId] DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});
