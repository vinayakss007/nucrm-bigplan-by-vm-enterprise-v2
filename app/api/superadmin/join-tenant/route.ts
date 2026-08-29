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
import { db } from '@/drizzle/db';
import { tenants, tenantMembers, roles, pipelines, dealStages } from '@/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

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

    // Check if already member
    const [existingMember] = await db
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, ctx.userId))
      .limit(1);

    if (!existingMember) {
      // Add superadmin to tenant as admin
      await db.insert(tenantMembers).values({
        userId: ctx.userId,
        tenantId: tenant.id,
        roleSlug: 'admin',
      });
    } else if (!existingMember.tenantId) {
      // Update existing placeholder membership
      await db
        .update(tenantMembers)
        .set({ tenantId: tenant.id, roleSlug: 'admin' })
        .where(eq(tenantMembers.userId, ctx.userId));
    }

    // Check if roles exist, if not create them
    const [existingRole] = await db.select().from(roles).where(eq(roles.tenantId, tenant.id)).limit(1);
    if (!existingRole) {
      await db.insert(roles).values([
        { tenantId: tenant.id, name: 'Admin', slug: 'admin', description: 'Full access', isSystem: true, permissions: { all: true }, sortOrder: 1 },
        { tenantId: tenant.id, name: 'Manager', slug: 'manager', description: 'Manage team', isSystem: true, permissions: { 'contacts.view': true, 'contacts.create': true, 'deals.view': true }, sortOrder: 2 },
        { tenantId: tenant.id, name: 'Sales Rep', slug: 'sales_rep', description: 'Standard access', isSystem: true, permissions: { 'contacts.view': true, 'deals.view': true }, sortOrder: 3 },
      ]);
    }

    // Check if pipeline exists
    const [existingPipeline] = await db.select().from(pipelines).where(eq(pipelines.tenantId, tenant.id)).limit(1);
    if (!existingPipeline) {
      const [_pipeline] = await db.transaction(async (tx) => {
        const [p] = await tx.insert(pipelines).values({
          tenantId: tenant.id,
          name: 'Sales Pipeline',
          description: 'Default sales pipeline',
          isDefault: true,
        }).returning();

        if (!p) throw new Error('Failed to create pipeline');

        await tx.insert(dealStages).values([
          { pipelineId: p.id, tenantId: tenant.id, name: 'Lead', order: 1 },
          { pipelineId: p.id, tenantId: tenant.id, name: 'Qualified', order: 2 },
          { pipelineId: p.id, tenantId: tenant.id, name: 'Proposal', order: 3 },
          { pipelineId: p.id, tenantId: tenant.id, name: 'Negotiation', order: 4 },
          { pipelineId: p.id, tenantId: tenant.id, name: 'Won', order: 5 },
          { pipelineId: p.id, tenantId: tenant.id, name: 'Lost', order: 6 },
        ]);

        return [p];
      });
    }

    return NextResponse.json({ 
      ok: true, 
      message: 'Added to tenant successfully',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/join-tenant POST]', err);
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
      currentTenant: ctx.tenantId === '__superadmin_no_tenant__' ? null : ctx.tenantId
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/join-tenant GET]', err);
    return apiError(err);
  }
});