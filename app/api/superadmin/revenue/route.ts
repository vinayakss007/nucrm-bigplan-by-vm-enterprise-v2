import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, plans, billingEvents } from '@/drizzle/schema';
import { eq, and, sql, desc, count } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [mrrRes, events] = await Promise.all([
      db
        .select({
          mrr: sql<number>`coalesce(sum(${plans.priceMonthly}), 0)`,
          paying: sql<number>`count(*) FILTER (WHERE ${tenants.status} = 'active')::int`,
          trialing: sql<number>`count(*) FILTER (WHERE ${tenants.status} = 'trialing')::int`,
          free_tier: sql<number>`count(*) FILTER (WHERE ${tenants.planId} = 'free')::int`,
          churned: sql<number>`count(*) FILTER (WHERE ${tenants.status} = 'cancelled')::int`,
          arr_monthly_equiv: sql<number>`coalesce(sum(${plans.priceYearly}::numeric / 12), 0)`,
        })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .then(rows => rows[0]),

      db
        .select({
          id: billingEvents.id,
          tenantId: billingEvents.tenantId,
          eventType: billingEvents.eventType,
          amount: billingEvents.amount,
          currency: billingEvents.currency,
          createdAt: billingEvents.createdAt,
          tenantName: tenants.name,
        })
        .from(billingEvents)
        .leftJoin(tenants, eq(tenants.id, billingEvents.tenantId))
        .orderBy(desc(billingEvents.createdAt))
        .limit(20)
        .catch(() => []),
    ]);

    return NextResponse.json({ mrr: mrrRes, events });
  } catch (err: any) {
    console.error('[superadmin/revenue GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

