/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, activities, tasks, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, inArray, notInArray, sql, desc, asc } from 'drizzle-orm';
import { resolveDealStageIds } from '@/lib/deals/won-stage-ids';
import { notArchived } from '@/lib/api/deals-archive-filter';
import { ownerScope, ownerScopeSql } from '@/lib/api/owner-scope';
import { logError, tenantMeta } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    // #2684 — the dashboard counted what the lists hide. Contacts archive via a
    // column, deals via metadata.archived, so both predicates come from the
    // places the rest of the app already reads them.
    const liveContact = sql`${contacts.isArchived} = false`;
    const liveDeal = notArchived();

    // #2688 — and the tiles counted, and showed, rows the caller's own list
    // refuses: contacts/route.ts:58-60, deals/route.ts:56-58, tasks/route.ts:38-40
    // all narrow without the entity's view_all. Spliced as text because these
    // counts go through db.execute, where `and()`'s skipping of undefined has no
    // equivalent. The route is uncached, so no key to widen; companies stay
    // tenant-wide — companies.view_all is enforced nowhere (#2597).
    const mineContact = ownerScopeSql(ownerScope(ctx, 'contacts.view_all', contacts));
    const mineDeal = ownerScopeSql(ownerScope(ctx, 'deals.view_all', deals));
    const mineTask = ownerScopeSql(ownerScope(ctx, 'tasks.view_all', tasks));

    // #3120 — "which stage ends a deal", and "which of those endings is a win",
    // is #658's rule (`isWonStageName`/`isLostStageName`), not a SQL string
    // comparison, so the tenant's stage rows are classified here and everything
    // below compares ids. This site used to resolve terminal stages with
    // `lower(name) IN ('won','lost')` capped at 20 rows while `won_this_month`
    // carried its own `lower(ds.name) = 'won'` subquery, so a tenant whose
    // pipeline says `Closed Won`/`Closed Lost` matched neither: the tile reported
    // 0 won revenue while the deals list, the leaderboards and the analytics page
    // all said otherwise, and the Upcoming Deals widget listed deals that closed
    // months ago because the empty terminal set made the route drop the exclusion
    // entirely. It costs one cheap read of the tenant's own stage
    // configuration — a handful of rows — to make every dashboard number answer
    // the same question the rest of the app answers.
    const stageIds = await resolveDealStageIds(db, tid);
    const terminalStageIds = stageIds.terminal;

    // Single optimized query: all stats in 2 round-trips (#3120 adds the
    // stage-vocabulary read ahead of them, so 3 in total)
    // Query 1: all counts + deals by stage (combined)
    const [combinedStats, dealsByStage] = await Promise.all([
      // Combined counts in a single query with subqueries
      db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM ${contacts} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND ${liveContact}${mineContact}) AS contact_count,
          (SELECT COUNT(*)::int FROM ${companies} WHERE tenant_id = ${tid} AND deleted_at IS NULL) AS company_count,
          (SELECT COUNT(*)::int FROM ${tasks} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND status != 'completed'${mineTask}) AS pending_tasks,
          (SELECT COALESCE(SUM(amount), 0)::float FROM ${deals} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND ${liveDeal}${mineDeal}) AS pipeline_total,
          (SELECT COUNT(*)::int FROM ${deals} WHERE tenant_id = ${tid} AND deleted_at IS NULL AND ${liveDeal}${mineDeal}) AS total_deals,
          (SELECT COALESCE(SUM(amount), 0)::float FROM ${deals}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND ${liveDeal}${mineDeal} AND created_at >= date_trunc('month', now())
          ) AS deals_this_month_value,
          (SELECT COUNT(*)::int FROM ${contacts}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND ${liveContact}${mineContact} AND created_at >= date_trunc('month', now())
          ) AS new_contacts_this_month,
          -- Folded here (was a trailing 8th query): the won-stage ids come from
          -- the #658 matcher resolved above (#3120), so this stays one
          -- round-trip and a renamed winning stage still counts. inArray renders
          -- the literal false for an empty list, which is the right answer for a
          -- tenant with no winning stage — 0, not "every deal".
          -- #3112 — the month key is the WIN date, not the creation date. A deal
          -- created in September and closed in October belongs to October's
          -- revenue; on created_at it silently left this tile (and
          -- widgets/stats/revenue). COALESCE falls back to created_at only where
          -- won_at was never recorded (v1 PUT, inbound webhook, automations —
          -- #3112), and created_at is a lower bound on the win, so the fallback
          -- can only keep an old count, never lose one.
          (SELECT COALESCE(SUM(${deals.amount}), 0)::float FROM ${deals}
           WHERE tenant_id = ${tid} AND deleted_at IS NULL AND ${liveDeal}${mineDeal} AND COALESCE(won_at, created_at) >= date_trunc('month', now())
           AND ${inArray(deals.stageId, stageIds.won)}
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
        notArchived(),
        ownerScope(ctx, 'deals.view_all', deals),
        eq(pipelines.tenantId, tid)
      ))
      .groupBy(dealStages.id, dealStages.name, dealStages.order)
      .orderBy(asc(dealStages.order)),
    ]);

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
      .where(and(
        eq(contacts.tenantId, tid),
        isNull(contacts.deletedAt),
        eq(contacts.isArchived, false),
        ownerScope(ctx, 'contacts.view_all', contacts),
      ))
      .orderBy(desc(contacts.createdAt))
      .limit(5),

      db.select({
        id: deals.id, title: deals.title, amount: deals.amount,
        closeDate: deals.closeDate, stageName: dealStages.name,
      })
      .from(deals)
      .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
      .where(and(
        eq(deals.tenantId, tid), isNull(deals.deletedAt), notArchived(),
        ownerScope(ctx, 'deals.view_all', deals),
        // #3120 — the old `terminalStageIds.length > 0 ? [...] : []` splice read
        // like a safe fallback and was the opposite: it treated "this tenant has
        // no stage called exactly 'Won'/'Lost'" as "nothing is ever closed", so
        // the widget listed deals that closed months ago. The predicate is now
        // always applied and the empty case is answered by drizzle, which
        // renders `notInArray(col, [])` as the literal `true` — correct here,
        // because a tenant whose matcher finds no terminal stage genuinely has
        // no closed deals to exclude. (The inclusion sites above need the other
        // half: `inArray(col, [])` renders `false`.)
        notInArray(deals.stageId, terminalStageIds),
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
        ownerScope(ctx, 'tasks.view_all', tasks),
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
