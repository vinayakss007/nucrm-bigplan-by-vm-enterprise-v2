import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, tenantMembers, plans } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    const memberCountSubquery = db
      .select({
        tenantId: tenantMembers.tenantId,
        count: sql<number>`count(*)::int`.as('member_count'),
      })
      .from(tenantMembers)
      .where(eq(tenantMembers.status, 'active'))
      .groupBy(tenantMembers.tenantId)
      .as('mc');

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
        member_count: sql<number>`COALESCE(${memberCountSubquery.count}, 0)`,
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
      .leftJoin(memberCountSubquery, eq(memberCountSubquery.tenantId, tenants.id))
      .where(eq(tenants.id, id))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    return NextResponse.json({ data: tenant });
  } catch (error) {
    console.error('[superadmin/tenants/[id]/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch tenant' }, { status: 500 });
  }
}
