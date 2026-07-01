import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tasks } from '@/drizzle/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'tasks-list', 120, async () => {
    const items = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
        status: tasks.status,
        completed: tasks.completed,
      })
      .from(tasks)
      .where(and(
        eq(tasks.tenantId, tid),
        isNull(tasks.deletedAt),
        eq(tasks.status, 'pending'),
      ))
      .orderBy(asc(tasks.dueDate))
      .limit(10);

    return NextResponse.json({ data: { items } });
  });
}
