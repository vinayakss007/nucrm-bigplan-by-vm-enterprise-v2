/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, plans, errorLogs, backupRecords, selectiveRestoreLogs, superAdminBackups } from '@/drizzle/schema';
import { eq, and, sql, desc, gt, inArray } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { getTrackedCount, getLeakedConnections } from '@/lib/db/leak-detector';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Helper function for safe queries
    const safeQuery = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        await logError({ error: err, context: 'superadmin/monitoring safeQuery' });
        return fallback;
      }
    };

    // Get tenant growth
    const tenantGrowth = await safeQuery(async () => {
      return await db.select({
        day: sql<string>`date_trunc('day', ${tenants.createdAt})::date::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(tenants)
      .where(gt(tenants.createdAt, sql`now() - interval '30 days'`))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    }, []);

    // Get plan distribution
    const planDist = await safeQuery(async () => {
      return await db.select({
        planId: tenants.planId,
        name: plans.name,
        priceMonthly: plans.priceMonthly,
        tenantCount: sql<number>`count(*)::int`,
      })
      .from(tenants)
      .leftJoin(plans, eq(tenants.planId, plans.id))
      .groupBy(tenants.planId, plans.name, plans.priceMonthly);
    }, []);

    // Get stats
    let stats: Record<string, unknown> = {};
    try {
      const statsRes = await db.execute(sql`SELECT public.platform_stats() as data`).catch((err) => { void logError({ error: err, context: 'superadmin/monitoring platform_stats query' }); return { rows: [{ data: {} }] }; });
            stats = (statsRes.rows[0] as { data?: Record<string, unknown> } | undefined)?.data ?? {};
      // Fill in missing fields computed from query data
      if (stats.mrr === undefined) stats.mrr = planDist.reduce((s: number, p) => s + Number(p.priceMonthly || 0) * Number(p.tenantCount || 0), 0);
      if (stats.trialing === undefined) stats.trialing = 0;
    } catch (err) {
      await logError({ error: err, context: 'superadmin/monitoring platform_stats processing' });
    }

    // Get recent errors
    const recentErrors = await safeQuery(async () => {
      return await db.select({
        id: errorLogs.id,
        level: errorLogs.level,
        code: errorLogs.code,
        message: errorLogs.message,
        tenantId: errorLogs.tenantId,
        createdAt: errorLogs.createdAt,
      })
      .from(errorLogs)
      .where(and(eq(errorLogs.resolved, false), inArray(errorLogs.level, ['error', 'fatal'])))
      .orderBy(desc(errorLogs.createdAt))
      .limit(10);
    }, []);

    // Get health checks
    const latestHealth = await safeQuery(async () => {
      const res = await db.execute(sql`
        SELECT DISTINCT ON (service) service, status, latency_ms, message, checked_at
        FROM public.health_checks 
        ORDER BY service, checked_at DESC
      `);
      return res.rows as unknown[];
    }, []);

    // Get backup status
    const backupStatus = await safeQuery(async () => {
      const [result] = await db.select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) FILTER (WHERE status = 'completed')::int`,
        failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
        running: sql<number>`count(*) FILTER (WHERE status = 'running')::int`,
      })
      .from(backupRecords);
      return result || { total: 0, completed: 0, failed: 0, running: 0 };
    }, { total: 0, completed: 0, failed: 0, running: 0 });

    // Get restore status
    const restoreStatus = await safeQuery(async () => {
      const [result] = await db.select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) FILTER (WHERE status = 'pending')::int`,
        running: sql<number>`count(*) FILTER (WHERE status = 'running')::int`,
        completed: sql<number>`count(*) FILTER (WHERE status = 'completed')::int`,
        failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
      })
      .from(selectiveRestoreLogs);
      return result || { total: 0, pending: 0, running: 0, completed: 0, failed: 0 };
    }, { total: 0, pending: 0, running: 0, completed: 0, failed: 0 });

    // Get recent backups
    const recentBackups = await safeQuery(async () => {
      return await db.select({
        id: superAdminBackups.id,
        backupName: superAdminBackups.backupName,
        status: superAdminBackups.status,
        sizeBytes: superAdminBackups.backupSize,
        createdAt: superAdminBackups.createdAt,
        completedAt: superAdminBackups.completedAt,
      })
      .from(superAdminBackups)
      .orderBy(desc(superAdminBackups.createdAt))
      .limit(10);
    }, []);

    // Get API usage stats (simulated from request logs if available)
    const apiStats = await safeQuery<Record<string, unknown>>(async () => {
      return {
        requests_today: 0,
        requests_this_month: 0,
        avg_response_time_ms: 0,
        error_rate_pct: 0,
        top_endpoints: [],
        _note: 'API usage tracking not yet implemented — values are placeholders',
      };
    }, {});

    // Get tenant activity (active in last 24h)
    const activeTenants = await safeQuery<{ rows: { count: number | string }[] }>(async () => {
      // sessions carries no tenant column (a user can belong to several
      // workspaces), so asking sessions for tenant_id raised 42703 on every
      // load and safeQuery handed back its fallback, which made the panel
      // report 0 active tenants.
      //
      // The workspace a session was used in comes from users.last_tenant_id —
      // NOT tenant_members, because that table has no policy a platform
      // connection can satisfy (it holds ~190 rows and a super-admin context
      // reads 0), so a membership join would report a permanent 0 that looks
      // like an honest answer.
      // db.execute() resolves to a QueryResult wrapper; only `rows` is read,
      // so the result is reinterpreted through a cast — runtime unchanged.
      const res = await db.execute(sql`
        SELECT COUNT(DISTINCT u.last_tenant_id) as count
        FROM public.sessions s
        JOIN users u ON u.id = s.user_id
        JOIN tenants t ON t.id = u.last_tenant_id
        WHERE s.created_at > now() - interval '24 hours'
      `);
      return res as unknown as { rows: { count: number | string }[] };
    }, { rows: [{ count: 0 }] });

    // Get database size estimate
    const dbSize = await safeQuery<{ rows: { size: string }[] }>(async () => {
      const res = await db.execute(sql`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `);
      return res as unknown as { rows: { size: string }[] };
    }, { rows: [{ size: '0 B' }] });

    // #1093: add the standard `data` key additively; keep legacy top-level keys.
    const payload = {
      stats,
      tenantGrowth,
      planDist,
      recentErrors,
      latestHealth,
      backupStatus,
      restoreStatus,
      recentBackups,
      apiStats,
      // db.execute() resolves to a result wrapper, not a rows array — the rest
      // of this route reads `.rows[0]` (see platform_stats above). Indexing the
      // wrapper itself made both of these permanently fall through to the
      // literal 0 / '0 B' even when the query returned real numbers.
      activeTenants: Number(activeTenants.rows[0]?.count ?? 0),
      dbSize: String(dbSize.rows[0]?.size ?? '0 B'),
      // #674: in-memory pinned-connection leak detector stats (no DB access)
      connectionStats: {
        tracked: getTrackedCount(),
        suspectedLeaks: getLeakedConnections().length,
      },
    };
    return NextResponse.json({ data: payload, ...payload });
 
 
  } catch (err) {
    await logError({ error: err, context: 'superadmin/monitoring GET', requestMethod: 'GET' });
    return apiError(err);
  }
});