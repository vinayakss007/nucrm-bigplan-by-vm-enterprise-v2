/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { db } from '@/drizzle/db';
import { tenants, tenantMembers, users } from '@/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { setTenantContext, NO_TENANT_SENTINEL } from '@/lib/db/rls';
import { provisionTenantWorkspace } from '@/lib/tenants/provision';
import { logError } from '@/lib/errors-server';

// tenantId is optional: when omitted (or an empty body is sent) the handler
// falls back to joining the first active tenant. Extra keys are ignored so a
// missing/empty body remains valid, preserving the original behavior.
const joinTenantSchema = z.object({
  tenantId: z.string().trim().min(1).optional(),
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    const limited = await rateLimitMutating(request, 'joinTenant', 'post');
    if (limited) return limited;

    // Parse optional tenantId from request body. A missing/empty/invalid body
    // is tolerated and falls back to default behavior (join first active tenant).
    let requestedTenantId: string | undefined;
    let rawBody: unknown;
    try {
      rawBody = await readJsonBody(request);
    } catch {
      rawBody = undefined;
    }
    if (rawBody !== undefined && rawBody !== null) {
      const validated = validateBody(joinTenantSchema, rawBody);
      if (validated instanceof NextResponse) return validated;
      requestedTenantId = validated.data.tenantId;
    }

    let tenant;
    if (requestedTenantId) {
      // Join a specific tenant by ID
      const [found] = await db.select().from(tenants).where(
        and(eq(tenants.id, requestedTenantId), eq(tenants.status, 'active'))
      ).limit(1);
      if (!found) {
        return NextResponse.json({ error: 'Tenant not found or not active' }, { status: 404 });
      }
      tenant = found;
    } else {
      // Find first active tenant (legacy behavior)
      const [found] = await db.select().from(tenants).where(eq(tenants.status, 'active')).limit(1);
      if (!found) {
        return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
      }
      tenant = found;
    }

    // Membership, roles and the default pipeline all isolate on
    // app.current_tenant with no super-admin escape, so writing them from the
    // console connection either matched no rows or raised 42501 while the route
    // still answered "Added to tenant successfully". Run the whole write in a
    // transaction that carries the target tenant's context, and reuse the shared
    // provisioning steps so joining an under-provisioned tenant repairs it too.
    await db.transaction(async (tx) => {
      await setTenantContext(tenant.id, ctx.userId, tx);
      await provisionTenantWorkspace(tx, {
        tenantId: tenant.id,
        userId: ctx.userId,
        planId: tenant.planId ?? 'free',
      });

      // The workspace is only usable once it is the account's current one:
      // requireAuth derives the tenant context from last_tenant_id, so without
      // this the join succeeds and the console still reports no workspace.
      await tx
        .update(users)
        .set({ lastTenantId: tenant.id, updatedAt: new Date() })
        .where(eq(users.id, ctx.userId));
    });

    return NextResponse.json({ 
      ok: true, 
      message: 'Added to tenant successfully',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'superadmin/join-tenant POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    // Get all tenants
    const allTenants = await db.select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      planId: tenants.planId,
      createdAt: tenants.createdAt,
    }).from(tenants).orderBy(sql`${tenants.createdAt} DESC`);

    // Get current user's tenant memberships
    const memberships = await db
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, ctx.userId));

    const memberTenantIds = memberships.map(m => m.tenantId).filter(Boolean);

    return NextResponse.json({
      tenants: allTenants,
      memberships: memberTenantIds,
      currentTenant: ctx.noWorkspace || ctx.tenantId === NO_TENANT_SENTINEL ? null : ctx.tenantId
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'superadmin/join-tenant GET', requestMethod: 'GET' });
    return apiError(err);
  }
});