import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, plans } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const [row] = await db
      .select({
        workspace_status: tenants.status,
        current_contacts: tenants.currentContacts,
        current_users: tenants.currentUsers,
        current_deals: tenants.currentDeals,
        trial_ends_at: tenants.trialEndsAt,
        trial_days_left: sql<number>`CASE WHEN ${tenants.trialEndsAt} IS NOT NULL
                   THEN GREATEST(0, EXTRACT(day FROM ${tenants.trialEndsAt} - now())::int)
                   ELSE NULL
              END`,
        max_contacts: plans.maxContacts,
        max_users: plans.maxUsers,
        max_deals: plans.maxDeals,
        plan_name: plans.name,
        plan_id: plans.id,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    return NextResponse.json({ data: row });
  } catch (err: any) {
    return apiError(err);
  }
}
