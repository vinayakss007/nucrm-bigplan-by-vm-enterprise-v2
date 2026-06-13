import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, tenantMembers, roles, pipelines, dealStages } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    // Find first active tenant
    const [tenant] = await db.select().from(tenants).where(eq(tenants.status, 'active')).limit(1);
    if (!tenant) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
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
      const [pipeline] = await db.insert(pipelines).values({
        tenantId: tenant.id,
        name: 'Sales Pipeline',
        description: 'Default sales pipeline',
        isDefault: true,
      }).returning();

      if (!pipeline) throw new Error('Failed to create pipeline');

      await db.insert(dealStages).values([
        { pipelineId: pipeline.id, name: 'Lead', order: 1 },
        { pipelineId: pipeline.id, name: 'Qualified', order: 2 },
        { pipelineId: pipeline.id, name: 'Proposal', order: 3 },
        { pipelineId: pipeline.id, name: 'Negotiation', order: 4 },
        { pipelineId: pipeline.id, name: 'Won', order: 5 },
        { pipelineId: pipeline.id, name: 'Lost', order: 6 },
      ]);
    }

    return NextResponse.json({ 
      ok: true, 
      message: 'Added to tenant successfully',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }
    });
  } catch (err: any) {
    console.error('[superadmin/join-tenant POST]', err);
    return apiError(err);
  }
}

export async function GET(request: NextRequest) {
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
  } catch (err: any) {
    console.error('[superadmin/join-tenant GET]', err);
    return apiError(err);
  }
}