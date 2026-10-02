/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, tenantMembers, plans } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { withTenantContext } from '@/lib/db/rls';

export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        plan_id: tenants.planId,
        plan_name: plans.name,
        billing_email: tenants.billingEmail,
        primary_color: tenants.primaryColor,
        owner_id: tenants.ownerId,
        owner_name: users.fullName,
        owner_email: users.email,
        member_count: sql<number>`0::int`,
        created_at: tenants.createdAt,
        updated_at: tenants.updatedAt,
        trial_ends_at: tenants.trialEndsAt,
        billing_type: tenants.billingType,
        admin_notes: tenants.adminNotes,
        stripe_customer_id: tenants.stripeCustomerId,
        manual_paid_until: tenants.manualPaidUntil,
        current_users: tenants.currentUsers,
        current_contacts: tenants.currentContacts,
        current_deals: tenants.currentDeals,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .leftJoin(users, eq(users.id, tenants.ownerId))
      .where(eq(tenants.id, id))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // tenant_members has no super-admin SELECT path, so a platform-console join
    // against it silently yields zero. Count it in a transaction that carries
    // the target tenant's context instead.
    const [members] = await withTenantContext(id, ctx.userId, async (tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, id), eq(tenantMembers.status, 'active')))
    );
    tenant.member_count = members?.count ?? 0;

    return NextResponse.json({ data: tenant });
  } catch (error) {
    await logError({ error, context: 'superadmin/tenants/[id] GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Failed to fetch tenant' }, { status: 500 });
  }
});
