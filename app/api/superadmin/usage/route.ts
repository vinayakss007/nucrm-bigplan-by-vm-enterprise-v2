import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, plans, usageSnapshots } from '@/drizzle/schema';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Trigger usage snapshot
    await db.execute(sql`SELECT public.snapshot_tenant_usage()`).catch(() => {});

    const [tenantUsage, growth] = await Promise.all([
      db.select({
        id: tenants.id,
        name: tenants.name,
        plan_id: tenants.planId,
        status: tenants.status,
        current_contacts: tenants.currentContacts,
        current_users: tenants.currentUsers,
        current_deals: tenants.currentDeals,
        max_contacts: plans.maxContacts,
        max_users: plans.maxUsers,
        max_deals: plans.maxDeals,
        price_monthly: plans.priceMonthly,
        contact_pct: sql<number>`CASE WHEN ${plans.maxContacts} > 0 THEN round((${tenants.currentContacts}::numeric / ${plans.maxContacts} * 100))::int ELSE 0 END`,
        user_pct: sql<number>`CASE WHEN ${plans.maxUsers} > 0 THEN round((${tenants.currentUsers}::numeric / ${plans.maxUsers} * 100))::int ELSE 0 END`,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(inArray(tenants.status, ['active', 'trialing']))
      .orderBy(desc(tenants.currentContacts))
      .limit(100),

      db.select({
        snapshot_date: usageSnapshots.snapshotDate,
        contacts: sql<number>`sum(${usageSnapshots.contactsCount})::int`,
        deals: sql<number>`sum(${usageSnapshots.dealsCount})::int`,
        users: sql<number>`sum(${usageSnapshots.usersCount})::int`,
      })
      .from(usageSnapshots)
      .where(sql`${usageSnapshots.snapshotDate} > CURRENT_DATE - 30`)
      .groupBy(usageSnapshots.snapshotDate)
      .orderBy(usageSnapshots.snapshotDate)
      .catch(() => []),
    ]);

    return NextResponse.json({ tenantUsage, growth });
  } catch (err: any) {
    console.error('[superadmin/usage GET]', err);
    return apiError(err);
  }
}

