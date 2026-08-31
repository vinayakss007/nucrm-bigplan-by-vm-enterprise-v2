/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { contacts, deals, tasks, dealStages } from '@/drizzle/schema';
import { eq, and, sql, count } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { rateLimitRead } from '@/lib/api/read-rate-limit';

// F4 (#1544): this endpoint used to ship raw row arrays capped at .limit(500)
// per entity (~143 KB per call) AND silently under-counted once a tenant had
// more than 500 rows. It now returns compact aggregates computed over the FULL
// tenant dataset. The sole consumer (app/tenant/analytics/analytics-client.tsx)
// reproduces every KPI/chart/label from these aggregates. Response shape:
//   data: {
//     deals: { byStage: [{ stageId, stageName, count, revenue }] },
//     contacts: { bySource: [{ source, count }], byStatus: [{ status, count }] },
//     tasks: { total, completed, open, overdue },
//     timeseries: { weekly: [{ weekStart, contacts, deals }] } // 8 fixed buckets
//   }

// #1838: wrapped in withApiRoute so requireTenantCtx()'s setTenantContext() and
// all the aggregate queries below share ONE pinned connection — otherwise RLS
// sees an empty tenant GUC on these queries and provides no isolation.
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitRead(request, 'analytics');
    if (limited) return limited;
    const ctx = await requireTenantCtx();
    if (ctx instanceof NextResponse) return ctx;

    // The client previously built 8 weekly buckets as
    //   weekStart = now - (7 - i) * 7 days, weekEnd = now - (6 - i) * 7 days
    // for i in 0..7, counting rows whose createdAt falls in [weekStart, weekEnd).
    // Reproduce the exact same JS boundaries so buckets match to the millisecond.
    const now = Date.now();
    const DAY = 86400000;
    const weekBounds = Array.from({ length: 8 }, (_, i) => {
      const start = new Date(now - (7 - i) * 7 * DAY);
      const end = new Date(now - (6 - i) * 7 * DAY);
      return { start, end };
    });

    // Per-bucket count expression: SUM(CASE WHEN created_at IN [start, end) THEN 1 ELSE 0 END).
    const weeklyCols = (createdAtCol: AnyColumn) =>
      weekBounds.reduce((acc, b, i) => {
        acc[`w${i}`] = sql<number>`COALESCE(SUM(CASE WHEN ${createdAtCol} >= ${b.start.toISOString()} AND ${createdAtCol} < ${b.end.toISOString()} THEN 1 ELSE 0 END), 0)::int`;
        return acc;
      }, {} as Record<string, ReturnType<typeof sql<number>>>);

    const [
      dealsByStageResult,
      contactsBySourceResult,
      contactsByStatusResult,
      tasksResult,
      contactsWeeklyResult,
      dealsWeeklyResult,
    ] = await Promise.all([
      // Deals grouped by the stage they point to, over the full dataset.
      db.select({
        stageId: dealStages.id,
        stageName: dealStages.name,
        count: count(),
        revenue: sql<string>`COALESCE(SUM(CAST(${deals.amount} AS NUMERIC)), 0)`,
      })
        .from(deals)
        .innerJoin(dealStages, eq(deals.stageId, dealStages.id))
        .where(and(eq(deals.tenantId, ctx.tenantId), sql`${deals.deletedAt} IS NULL`))
        .groupBy(dealStages.id, dealStages.name),

      // Contacts grouped by lead source.
      db.select({
        source: contacts.leadSource,
        count: count(),
      })
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
        .groupBy(contacts.leadSource),

      // Contacts grouped by lead status.
      db.select({
        status: contacts.leadStatus,
        count: count(),
      })
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
        .groupBy(contacts.leadStatus),

      // Single tasks aggregate: total, completed, overdue.
      db.select({
        total: count(),
        completed: sql<number>`COALESCE(SUM(CASE WHEN ${tasks.completed} = true THEN 1 ELSE 0 END), 0)::int`,
        overdue: sql<number>`COALESCE(SUM(CASE WHEN ${tasks.completed} IS NOT TRUE AND ${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < CURRENT_DATE THEN 1 ELSE 0 END), 0)::int`,
      })
        .from(tasks)
        .where(and(eq(tasks.tenantId, ctx.tenantId), sql`${tasks.deletedAt} IS NULL`)),

      // Weekly contact counts across the 8 fixed buckets.
      db.select(weeklyCols(contacts.createdAt))
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`)),

      // Weekly deal counts across the 8 fixed buckets.
      db.select(weeklyCols(deals.createdAt))
        .from(deals)
        .where(and(eq(deals.tenantId, ctx.tenantId), sql`${deals.deletedAt} IS NULL`)),
    ]);

    const byStage = dealsByStageResult.map(r => ({
      stageId: r.stageId,
      stageName: r.stageName,
      count: Number(r.count),
      revenue: Number(r.revenue),
    }));

    const bySource = contactsBySourceResult.map(r => ({
      source: r.source,
      count: Number(r.count),
    }));

    const byStatus = contactsByStatusResult.map(r => ({
      status: r.status,
      count: Number(r.count),
    }));

    const tasksAgg = tasksResult[0] ?? { total: 0, completed: 0, overdue: 0 };
    const total = Number(tasksAgg.total);
    const completed = Number(tasksAgg.completed);
    const overdue = Number(tasksAgg.overdue);

    const contactsWeekly = contactsWeeklyResult[0] ?? {};
    const dealsWeekly = dealsWeeklyResult[0] ?? {};
    const weekly = weekBounds.map((b, i) => ({
      weekStart: b.start.toISOString(),
      contacts: Number((contactsWeekly as Record<string, unknown>)[`w${i}`] ?? 0),
      deals: Number((dealsWeekly as Record<string, unknown>)[`w${i}`] ?? 0),
    }));

    return NextResponse.json({
      data: {
        deals: { byStage },
        contacts: { bySource, byStatus },
        tasks: { total, completed, open: total - completed, overdue },
        timeseries: { weekly },
      },
    });
  } catch (error) {
    void logError({ error, context: 'tenant/analytics/overview GET' });
    return NextResponse.json({ error: 'Failed to fetch analytics data' }, { status: 500 });
  }
});
