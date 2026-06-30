import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { followUps } from '@/drizzle/schema';
import { eq, and, isNull, asc, lte, sql, inArray } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'follow-ups-list', 120, async () => {
    const now = new Date();

    const items = await db
      .select({
        id: followUps.id,
        title: followUps.title,
        dueDate: followUps.dueDate,
        status: followUps.status,
        missedDays: followUps.missedDays,
        autoAiEnabled: followUps.autoAiEnabled,
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

    const [stats] = await db.select({
      todayCount: sql<number>`count(*) filter (where ${followUps.dueDate}::date = CURRENT_DATE and ${followUps.status} in ('pending', 'missed'))::int`,
      overdueCount: sql<number>`count(*) filter (where ${followUps.dueDate}::date < CURRENT_DATE and ${followUps.status} in ('pending', 'missed'))::int`,
      totalPending: sql<number>`count(*) filter (where ${followUps.status} in ('pending', 'missed'))::int`,
    })
    .from(followUps)
    .where(and(
      eq(followUps.tenantId, tid),
      isNull(followUps.deletedAt),
    ));

    return NextResponse.json({
      data: {
        items,
        stats: {
          todayCount: stats?.todayCount ?? 0,
          overdueCount: stats?.overdueCount ?? 0,
          totalPending: stats?.totalPending ?? 0,
        },
      },
    });
  });
}
