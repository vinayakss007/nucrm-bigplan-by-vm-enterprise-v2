/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, activities, tasks, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, notInArray, sql, desc, asc } from 'drizzle-orm';
import { logError, tenantMeta } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    // Single optimized query: all stats in 2 round-trips
    // Query 1: Terminal stages + all counts + deals by stage (combined)
    const [terminalStages, combinedStats, dealsByStage] = await Promise.all([
      // Get terminal stage IDs for filtering
      db.select({ id: dealStages.id, name: dealStages.name })
        .from(dealStages)
        .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
        .where(and(eq(pipelines.tenantId, tid), sql`lower(${dealStages.name}) IN ('won', 'lost')`))
        .limit(20),

      // Combined counts in a single query with subqueries
      db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM ${contacts} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS contact_count,
          (SELECT COUNT(*)::int FROM ${companies} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS company_count,
          (SELECT COUNT(*)::int FROM ${tasks} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed') AS pending_tasks,
          (SELECT COALESCE(SUM(amount), 0)::float FROM ${deals} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS pipeline_total,
          (SELECT COUNT(*)::int FROM ${deals} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS total_deals,
          (SELECT COALESCE(SUM(amount), 0)::float FROM ${deals}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())
          ) AS deals_this_month_value,
          (SELECT COUNT(*)::int FROM ${contacts}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())
          ) AS new_contacts_this_month,
          -- Folded here (was a trailing 8th query): won-stage ids resolved
          -- inline so this stays a single round-trip.
          (SELECT COALESCE(SUM(${deals.amount}), 0)::float FROM ${deals}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())
           AND stage_id IN (
             SELECT ds.id FROM ${dealStages} ds
             INNER JOIN ${pipelines} p ON p.id = ds.pipeline_id
             WHERE p.tenant_id = ${tid} AND lower(ds.name) = 'won'
           )
          ) AS won_this_month
      `),

      // Deals by stage in a single query
      db.select({
        stageName: dealStages.name,
        stageOrder: dealStages.order,
        count: sql<number>`COUNT(*)::int`,
        total: sql<number>`COALESCE(SUM(${deals.amount}), 0)::float`,
      })
      .from(deals)
      .innerJoin(dealStages, eq(dealStages.id, deals.stageId))
      .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
      .where(and(
        eq(deals.tenantId, tid),
        isNull(deals.deletedAt),
        eq(pipelines.tenantId, tid)
      ))
      .groupBy(dealStages.id, dealStages.name, dealStages.order)
      .orderBy(asc(dealStages.order)),
    ]);

    const terminalStageIds = terminalStages.map(s => s.id);
    const counts = combinedStats.rows?.[0] || {};

    // Query 2: Recent data (parallel — 4 lightweight queries)
    const [recentActivities, recentContacts, upcomingDeals, pendingTasksList] = await Promise.all([
      db.select({
        id: activities.id, description: activities.description,
        eventType: activities.eventType, createdAt: activities.createdAt,
      })
      .from(activities)
      .where(and(eq(activities.tenantId, tid), isNull(activities.deletedAt)))
      .orderBy(desc(activities.createdAt))
      .limit(8),

      db.select({
        id: contacts.id, firstName: contacts.firstName,
        lastName: contacts.lastName, email: contacts.email, status: contacts.leadStatus,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tid), isNull(contacts.deletedAt)))
      .orderBy(desc(contacts.createdAt))
      .limit(5),

      db.select({
        id: deals.id, title: deals.title, amount: deals.amount,
        closeDate: deals.closeDate, stageName: dealStages.name,
      })
      .from(deals)
      .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
      .where(and(
        eq(deals.tenantId, tid), isNull(deals.deletedAt),
        ...(terminalStageIds.length > 0 ? [notInArray(deals.stageId, terminalStageIds)] : []),
      ))
      .orderBy(asc(deals.closeDate))
        .limit(5),

      db.select({
        id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, priority: tasks.priority,
      })
      .from(tasks)
      .where(and(
        eq(tasks.tenantId, tid),
        isNull(tasks.deletedAt),
        sql`${tasks.status} != 'completed'`,
      ))
      .orderBy(asc(tasks.dueDate))
      .limit(5),
    ]);

    const data = {
      contactCount: Number(counts['contact_count'] ?? 0),
      companyCount: Number(counts['company_count'] ?? 0),
      pendingTasks: Number(counts['pending_tasks'] ?? 0),
      pipeline: Number(counts['pipeline_total'] ?? 0),
      totalDeals: Number(counts['total_deals'] ?? 0),
      dealsThisMonthValue: Number(counts['deals_this_month_value'] ?? 0),
      newContactsThisMonth: Number(counts['new_contacts_this_month'] ?? 0),
      wonThisMonth: Number(counts['won_this_month'] ?? 0),
      activities: recentActivities,
      tasks: pendingTasksList,
      dealsByStage: dealsByStage.map(s => ({ stage: s.stageName, count: s.count, total: s.total })),
      recentContacts: recentContacts,
      upcomingDeals: upcomingDeals,
    };

    return NextResponse.json({ data });
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/stats', ...tenantMeta(ctx) });
    return NextResponse.json({
      data: {
        contactCount: 0, companyCount: 0, pendingTasks: 0, pipeline: 0, totalDeals: 0,
        dealsThisMonthValue: 0, newContactsThisMonth: 0, wonThisMonth: 0,
        activities: [], tasks: [], dealsByStage: [], recentContacts: [], upcomingDeals: [],
      },
      error: "Internal server error",
      status: 'error'
    }, { status: 500 });
  }
});
