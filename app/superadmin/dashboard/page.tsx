/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUserForToken } from '@/lib/auth/session';
import { withUserContext, withSecurityContext } from '@/lib/db/rls';
import { users, tenants, plans, errorLogs } from '@/drizzle/schema';
import { eq, and, sql, desc, between } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import SuperAdminDashboardClient from '@/components/superadmin/superadmin-dashboard-client';

export default async function SuperAdminDashboard() {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/auth/login');
  // #2216: a revoked (logged-out) JWT must not keep the platform console open.
  const payload = await getCurrentUserForToken(token);
  if (!payload) redirect('/auth/login');

  // See app/superadmin/layout.tsx: this read must carry the verified identity
  // or fail-closed RLS returns zero rows and bounces a real super admin.
  const [user] = await withUserContext(payload.id, async (tx) => await tx.select({
    isSuperAdmin: users.isSuperAdmin,
    fullName: users.fullName,
  })
  .from(users)
  .where(eq(users.id, payload.id))
  .limit(1));

  if (!user?.isSuperAdmin) redirect('/tenant/dashboard');

  // Every read below is platform-wide (all tenants, all users, the global error
  // log), so none of them satisfy a tenant-scoped RLS policy. Each one is
  // wrapped in its own security context — separate transactions, so a failing
  // query degrades its own panel section instead of aborting the others.
  const [statsRes, recentTenants, recentErrors, expiringSoon] = await Promise.all([
    withSecurityContext(async (tx) => await tx.execute(sql`SELECT public.platform_stats() as data`))
      .catch((err) => { logger.error('[dashboard] platform_stats failed', { error: err instanceof Error ? err.message : String(err) }); return { rows: [{ data: {} }] }; }),

    withSecurityContext(async (tx) => await tx.select({
      id: tenants.id,
      name: tenants.name,
      plan_id: tenants.planId,
      status: tenants.status,
      created_at: tenants.createdAt,
      trial_ends_at: tenants.trialEndsAt,
      price_monthly: plans.priceMonthly,
      owner_email: users.email,
    })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .leftJoin(users, eq(users.id, tenants.ownerId))
    .orderBy(desc(tenants.createdAt))
    .limit(6))
    .catch((err) => { logger.error('[dashboard] recentTenants failed', { error: err instanceof Error ? err.message : String(err) }); return []; }),

    withSecurityContext(async (tx) => await tx.select({
      level: errorLogs.level,
      message: errorLogs.message,
      created_at: errorLogs.createdAt,
    })
    .from(errorLogs)
    .where(and(
      eq(errorLogs.resolved, false),
      sql`${errorLogs.level} IN ('error','fatal')`
    ))
    .orderBy(desc(errorLogs.createdAt))
    .limit(5))
    .catch((err) => { logger.error('[dashboard] recentErrors failed', { error: err instanceof Error ? err.message : String(err) }); return []; }),

    withSecurityContext(async (tx) => await tx.select({
      id: tenants.id,
      name: tenants.name,
      trial_ends_at: tenants.trialEndsAt,
      days_left: sql<number>`EXTRACT(day FROM ${tenants.trialEndsAt} - now())::int`,
    })
    .from(tenants)
    .where(and(
      eq(tenants.status, 'trialing'),
      between(tenants.trialEndsAt, sql`now()`, sql`now() + interval '3 days'`)
    ))
    .orderBy(tenants.trialEndsAt))
    .catch((err) => { logger.error('[dashboard] expiringSoon failed', { error: err instanceof Error ? err.message : String(err) }); return []; }),
  ]);

  const s = (statsRes as unknown as { rows?: [{ data?: Record<string, unknown> }] })?.rows?.[0]?.data ?? {};

  return (
    <SuperAdminDashboardClient
      stats={{
        mrr: Number(s.mrr ?? 0),
        active_tenants: Number(s.active_tenants ?? 0),
        total_users: Number(s.total_users ?? 0),
        unresolved_errors: Number(s.unresolved_errors ?? 0),
        trialing: Number(s.trialing ?? 0),
      }}
      recentTenants={recentTenants as never[]}
      recentErrors={recentErrors as never[]}
      expiringSoon={expiringSoon as never[]}
      userName={user.fullName ?? 'Admin'}
    />
  );
}
