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
import { createRoleSchema } from '@/lib/api/schemas';
import { roles, tenantMembers } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { withTenantContext } from '@/lib/db/rls';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { isUuid } from '@/lib/id';

/**
 * One tenant's roles, addressed by the tenant in the path.
 *
 * The panel page read and wrote `/api/tenant/roles` instead, which resolves the
 * tenant from the caller's own session — so it listed the SUPER ADMIN's tenant
 * and saved edits back to that one, while its create button posted to
 * `/api/superadmin/tenants/roles`, a route that never existed.
 *
 * `roles` isolates on app.current_tenant with no super-admin branch, so every
 * statement here runs in a transaction carrying the TARGET tenant's context.
 */
type RoleRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  permissions: unknown;
  is_system: boolean | null;
  createdAt: Date;
  user_count: number;
};

export const GET = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;
    if (!isUuid(tenantId)) return NextResponse.json({ error: 'Invalid tenant id' }, { status: 400 });

    const data = await withTenantContext<RoleRow[]>(tenantId, ctx.userId, async (tx) => {
      const rows = await tx
        .select({
          id: roles.id,
          name: roles.name,
          slug: roles.slug,
          description: roles.description,
          permissions: roles.permissions,
          is_system: roles.isSystem,
          createdAt: roles.createdAt,
        })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
        .orderBy(roles.name);

      // The panel keys its System badge and its delete button off is_system, and
      // counts members per role; reading /api/tenant/roles gave it neither, so
      // every role rendered as an editable custom role with "undefined users".
      const counts = rows.length
        ? await tx
            .select({ roleId: tenantMembers.roleId, count: sql<number>`count(*)::int` })
            .from(tenantMembers)
            .where(and(eq(tenantMembers.tenantId, tenantId), isNull(tenantMembers.deletedAt)))
            .groupBy(tenantMembers.roleId)
        : [];
      const byRole = new Map(counts.map((c) => [c.roleId, c.count]));

      return rows.map((row) => ({ ...row, user_count: byRole.get(row.id) ?? 0 }));
    });

    return NextResponse.json({ data, tenantId });
  } catch (err) {
    await logError({ error: err, context: 'superadmin/tenants/[id]/roles GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(request, 'superadmin-roles', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;
    if (!isUuid(tenantId)) return NextResponse.json({ error: 'Invalid tenant id' }, { status: 400 });

    const body = await readJsonBody(request);
    const validated = validateBody(createRoleSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Same derivation as app/api/tenant/roles/route.ts: a role created from the
    // panel has to be addressable by the slug-matching code that already exists.
    const slug = v.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const created = await withTenantContext<{ kind: 'taken' } | { kind: 'row'; row: typeof roles.$inferSelect }>(
      tenantId, ctx.userId, async (tx) => {
        const taken = await tx.select({ id: roles.id }).from(roles)
          .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, slug), isNull(roles.deletedAt)))
          .limit(1);
        if (taken.length > 0) return { kind: 'taken' as const };

        const inserted = await tx.insert(roles)
          .values({
            tenantId,
            name: v.name,
            slug,
            description: v.description || null,
            permissions: v.permissions || {},
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('roles INSERT returned no row');
        return { kind: 'row' as const, row };
      }
    );

    if (created.kind === 'taken') {
      return NextResponse.json({ error: 'A role with this name already exists' }, { status: 409 });
    }

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || '',
      action: 'role.created',
      targetType: 'tenant',
      targetId: tenantId,
      metadata: { role_id: created.row.id, role_slug: created.row.slug },
    });

    return NextResponse.json({ data: created.row }, { status: 201 });
  } catch (err) {
    const pg = err as { code?: string; cause?: { code?: string } };
    const code = pg.cause?.code ?? pg.code;
    // Race against the pre-check: the unique (tenant_id, slug) index wins.
    if (code === '23505') {
      return NextResponse.json({ error: 'A role with this name already exists' }, { status: 409 });
    }
    // No such tenant — the FK is what tells us, so answer 404 rather than 500.
    if (code === '23503') {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    await logError({ error: err, context: 'superadmin/tenants/[id]/roles POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
