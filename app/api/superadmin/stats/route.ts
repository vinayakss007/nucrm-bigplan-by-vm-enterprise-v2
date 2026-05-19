import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, plans, users, errorLogs } from '@/drizzle/schema';
import { eq, and, sql, desc, gt, between, or } from 'drizzle-orm';
import { logError } from '@/lib/errors';

/**
 * Super Admin Platform Stats API
 * Returns all platform statistics in a single request
 * Cached on client-side for 2 minutes
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Verify super admin
    const [user] = await db
      .select({ isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    
    if (!user?.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [statsRes, recentTenants, recentErrors, recentActivity, expiringSoon, platformUsageRes] = await Promise.all([
      db.execute(sql`SELECT public.platform_stats() as data`).catch(() => ({ rows: [{ data: {} }] })),
      
      db.select({
        id: tenants.id,
        name: tenants.name,
        planId: tenants.planId,
        status: tenants.status,
        createdAt: tenants.createdAt,
        trialEndsAt: tenants.trialEndsAt,
        priceMonthly: plans.priceMonthly,
        ownerEmail: users.email,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .leftJoin(users, eq(users.id, tenants.ownerId))
      .orderBy(desc(tenants.createdAt))
      .limit(6)
      .catch(() => []),

      db.select({
        level: errorLogs.level,
        message: errorLogs.message,
        createdAt: errorLogs.createdAt,
      })
      .from(errorLogs)
      .where(and(eq(errorLogs.resolved, false), or(eq(errorLogs.level, 'error'), eq(errorLogs.level, 'fatal'))))
      .orderBy(desc(errorLogs.createdAt))
      .limit(5)
      .catch(() => []),

      db.select({
        name: tenants.name,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(gt(tenants.createdAt, sql`now() - interval '7 days'`))
      .orderBy(desc(tenants.createdAt))
      .limit(8)
      .then(rows => rows.map(r => ({ type: 'tenant_created', ...r })))
      .catch(() => []),

      db.select({
        id: tenants.id,
        name: tenants.name,
        trialEndsAt: tenants.trialEndsAt,
        daysLeft: sql<number>`EXTRACT(day FROM ${tenants.trialEndsAt} - now())::int`,
      })
      .from(tenants)
      .where(and(eq(tenants.status, 'trialing'), between(tenants.trialEndsAt, sql`now()`, sql`now() + interval '3 days'`)))
      .orderBy(tenants.trialEndsAt)
      .catch(() => []),

      db.select({
        totalTenants: sql<number>`COUNT(*)::int`,
        activeTenants: sql<number>`COUNT(*) FILTER (WHERE ${tenants.status} = 'active')`,
        trialingTenants: sql<number>`COUNT(*) FILTER (WHERE ${tenants.status} = 'trialing')`,
        suspendedTenants: sql<number>`COUNT(*) FILTER (WHERE ${tenants.status} = 'suspended')`,
      })
      .from(tenants)
      .then(rows => rows[0])
      .catch(() => ({ totalTenants: 0, activeTenants: 0, trialingTenants: 0, suspendedTenants: 0 })),
    ]);

    const s = (statsRes.rows[0] as any)?.data ?? {};
    const mrr = Number(s.mrr ?? 0);

    const response = {
      mrr,
      arr: mrr * 12,
      activeTenants: s.active_tenants ?? 0,
      totalTenants: platformUsageRes?.totalTenants ?? 0,
      trialingTenants: s.trialing ?? 0,
      totalUsers: s.total_users ?? 0,
      unresolvedErrors: recentErrors.length,
      recentTenants,
      recentErrors,
      recentActivity,
      expiringSoon,
      platformUsage: {
        total: platformUsageRes?.totalTenants ?? 0,
        active: platformUsageRes?.activeTenants ?? 0,
        trialing: platformUsageRes?.trialingTenants ?? 0,
        suspended: platformUsageRes?.suspendedTenants ?? 0,
      },
    };

    return NextResponse.json({ data: response });
  } catch (err: any) {
    console.error('[superadmin/stats GET]', err);
    logError({ error: err, context: 'superadmin stats API' }).catch(() => {});
    return NextResponse.json({ error: 'Failed to fetch platform stats' }, { status: 500 });
  }
}

