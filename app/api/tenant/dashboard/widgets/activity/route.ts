import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { activities } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'activity', 60, async () => {
    const items = await db
      .select({
        id: activities.id,
        description: activities.description,
        type: activities.eventType,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .where(and(eq(activities.tenantId, tid), isNull(activities.deletedAt)))
      .orderBy(desc(activities.createdAt))
      .limit(8);

    return NextResponse.json({ data: { items } });
  });
}
