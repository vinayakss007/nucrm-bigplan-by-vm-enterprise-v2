/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { followUps } from '@/drizzle/schema';
import { eq, and, isNull, asc, lte, sql, inArray } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';
import { logError, tenantMeta } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    return withCache(tid, 'follow-ups-list', 120, async () => {
      const now = new Date();

      // Single round-trip: items + aggregate stats as scalar subselects
      // (previously two serial queries, each a full WAN RTT).
      const rows = await db
        .select({
          id: followUps.id,
          title: followUps.title,
          dueDate: followUps.dueDate,
          status: followUps.status,
          missedDays: followUps.missedDays,
          autoAiEnabled: followUps.autoAiEnabled,
          todayCount: sql<number>`(SELECT count(*)::int FROM ${followUps} f WHERE f.tenant_id = ${tid} AND f.deleted_at IS NULL AND f.status IN ('pending', 'missed') AND f.due_date::date = CURRENT_DATE)`,
          overdueCount: sql<number>`(SELECT count(*)::int FROM ${followUps} f WHERE f.tenant_id = ${tid} AND f.deleted_at IS NULL AND f.status IN ('pending', 'missed') AND f.due_date::date < CURRENT_DATE)`,
          totalPending: sql<number>`(SELECT count(*)::int FROM ${followUps} f WHERE f.tenant_id = ${tid} AND f.deleted_at IS NULL AND f.status IN ('pending', 'missed'))`,
        })
        .from(followUps)
        .where(and(
          eq(followUps.tenantId, tid),
          isNull(followUps.deletedAt),
          inArray(followUps.status, ['pending', 'missed']),
          lte(followUps.dueDate, now),
        ))
        .orderBy(asc(followUps.dueDate))
        .limit(5);

      const first = rows[0];
      const items = rows.map((r) => ({
        id: r.id,
        title: r.title,
        dueDate: r.dueDate,
        status: r.status,
        missedDays: r.missedDays,
        autoAiEnabled: r.autoAiEnabled,
      }));

      return NextResponse.json({
        data: {
          items,
          stats: {
            todayCount: first?.todayCount ?? 0,
            overdueCount: first?.overdueCount ?? 0,
            totalPending: first?.totalPending ?? 0,
          },
        },
      });
    });
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/follow-ups', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
